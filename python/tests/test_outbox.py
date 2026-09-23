"""The outbox: delivery that survives a restart, an outage and a race.

Each test is one of the module docstring's decisions, stated as the failure it
prevents. Everything runs against an in-memory SQLite database and fake
senders, so nothing opens a socket except the `post_json` tests, which run
their own server on a loopback port.
"""

from __future__ import annotations

import asyncio
import http.server
import json
import threading
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import JSON, Column, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Field, Session, SQLModel, create_engine

from ai_core import outbox
from ai_core.outbox import (
    HELD,
    PENDING,
    REJECTED,
    SENDING,
    SENT,
    VOID,
    Channel,
    OutboxRow,
    Outcome,
    RetryPolicy,
    Sweeper,
    classify_status,
    deliver,
    post_json,
    requeue,
    summary,
)
from ai_core.schema_repair import ensure_schema
from ai_core.timeutil import as_utc, utcnow


class Owed(OutboxRow, table=True):
    __tablename__ = "test_owed_outbox"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group: str = "a"
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))


NO_JITTER = RetryPolicy(jitter=0.0, max_failures=3)


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine, tables=[Owed.__table__])
    return engine


@pytest.fixture
def db(engine):
    with Session(engine) as session:
        yield session


def _rows(db, n=1, **fields):
    rows = [Owed(payload={"n": i}, **fields) for i in range(n)]
    for row in rows:
        db.add(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


class Recorder:
    """A sender that answers from a script and remembers every batch."""

    def __init__(self, *outcomes: Outcome):
        self.outcomes = list(outcomes)
        self.batches: list[list[dict]] = []

    def __call__(self, rows):
        self.batches.append([dict(r.payload) for r in rows])
        return self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]


def _channel(sender, **kwargs):
    return Channel(name="test", model=Owed, send=sender, policy=NO_JITTER, **kwargs)


# ─────────────────────────────────────────────────────────────────────────
#  The happy path, and what it leaves behind
# ─────────────────────────────────────────────────────────────────────────


def test_a_delivered_row_is_marked_sent_and_not_sent_again(db):
    (row,) = _rows(db)
    sender = Recorder(Outcome.sent("http_201"))

    first = deliver(db, _channel(sender))
    second = deliver(db, _channel(sender))

    db.refresh(row)
    assert (row.state, row.attempts, row.last_error) == (SENT, 1, None)
    assert row.sent_at is not None
    assert first.sent == 1 and second.sent == 0
    assert len(sender.batches) == 1


def test_void_is_terminal_and_keeps_its_reason(db):
    """"Nothing was owed" is an answer, not an error — but it is worth reading."""
    (row,) = _rows(db)
    report = deliver(db, _channel(Recorder(Outcome.void("no ledger rows for this turn"))))

    db.refresh(row)
    assert row.state == VOID
    assert row.last_error == "no ledger rows for this turn"
    assert report.void == 1 and report.moved == 1


# ─────────────────────────────────────────────────────────────────────────
#  An outage is not the row's fault
# ─────────────────────────────────────────────────────────────────────────


def test_an_unreachable_upstream_never_holds_a_row(db):
    """The failure this prevents: M04 down for an afternoon, every observation
    held by evening, and nothing delivered when M04 comes back until a person
    notices. Unreachable backs off; it does not count."""
    (row,) = _rows(db)
    down = _channel(Recorder(Outcome.unreachable("ConnectionRefusedError")))

    for _ in range(NO_JITTER.max_failures * 3):
        row.next_attempt_at = None  # skip the wait, keep the verdict
        db.add(row)
        db.commit()
        deliver(db, down)
        db.refresh(row)

    assert row.state == PENDING
    assert row.failures == 0
    assert row.attempts == NO_JITTER.max_failures * 3


def test_an_upstream_that_answers_with_errors_is_held_for_a_person(db):
    (row,) = _rows(db)
    failing = _channel(Recorder(Outcome.retry("http_500: boom")))

    states = []
    for _ in range(NO_JITTER.max_failures):
        row.next_attempt_at = None
        db.add(row)
        db.commit()
        deliver(db, failing)
        db.refresh(row)
        states.append(row.state)

    assert states == [PENDING] * (NO_JITTER.max_failures - 1) + [HELD]
    assert row.failures == NO_JITTER.max_failures
    assert row.last_error == "http_500: boom"


def test_a_row_backing_off_is_not_due(db):
    (row,) = _rows(db)
    deliver(db, _channel(Recorder(Outcome.retry("http_500"))))
    db.refresh(row)

    wait = (as_utc(row.next_attempt_at) - utcnow()).total_seconds()
    assert 0 < wait <= NO_JITTER.base_s
    assert outbox.due(db, Owed, policy=NO_JITTER) == []
    later = utcnow() + timedelta(seconds=NO_JITTER.base_s + 1)
    assert [r.id for r in outbox.due(db, Owed, now=later, policy=NO_JITTER)] == [row.id]


def test_backoff_grows_and_is_capped():
    policy = RetryPolicy(base_s=10, factor=2, cap_s=60, jitter=0)
    assert [policy.delay_s(n) for n in range(1, 7)] == [10, 20, 40, 60, 60, 60]


def test_jitter_stays_inside_its_band():
    policy = RetryPolicy(base_s=100, jitter=0.2, cap_s=1000)
    assert policy.delay_s(1, rng=lambda: 0.0) == pytest.approx(80)
    assert policy.delay_s(1, rng=lambda: 1.0) == pytest.approx(120)


def test_one_closed_door_stops_the_pass(db):
    """Three batches, first finds the upstream down: the other two are not
    each made to wait out a timeout, and are not charged an attempt."""
    rows = _rows(db, 3)
    for row, group in zip(rows, "abc", strict=True):
        row.group = group
        db.add(row)
    db.commit()
    sender = Recorder(Outcome.unreachable("timed out"))

    report = deliver(db, _channel(sender, batch_key=lambda r: r.group))

    assert report.circuit_open is True
    assert len(sender.batches) == 1
    attempts = sorted((db.get(Owed, r.id).attempts) for r in rows)
    assert attempts == [0, 0, 1]


def test_a_send_that_gets_through_rearms_rows_still_waiting_out_an_outage(db):
    """Recovery is noticed by the first row that gets through, not by the last
    timer to expire. Otherwise a ten-minute cap is a ten-minute delay after
    every outage."""
    waiting, fresh = _rows(db, 2)
    waiting.next_attempt_at = utcnow() + timedelta(minutes=10)
    db.add(waiting)
    db.commit()

    deliver(db, _channel(Recorder(Outcome.sent())))

    db.refresh(waiting)
    db.refresh(fresh)
    assert fresh.state == SENT
    assert waiting.state == PENDING and waiting.next_attempt_at is None


# ─────────────────────────────────────────────────────────────────────────
#  Claim before sending
# ─────────────────────────────────────────────────────────────────────────


def test_two_senders_cannot_both_claim_one_row(engine):
    with Session(engine) as a, Session(engine) as b:
        (row,) = _rows(a)
        row_b = b.get(Owed, row.id)

        assert outbox.claim(a, Owed, row) is True
        assert outbox.claim(b, Owed, row_b) is False


def test_a_fresh_claim_is_not_due_and_a_stale_one_is(db):
    (row,) = _rows(db)
    row.state, row.claimed_at = SENDING, utcnow()
    db.add(row)
    db.commit()
    assert outbox.due(db, Owed, policy=NO_JITTER) == []

    row.claimed_at = utcnow() - timedelta(seconds=NO_JITTER.stale_claim_s + 5)
    db.add(row)
    db.commit()
    (found,) = outbox.due(db, Owed, policy=NO_JITTER)
    assert outbox.claim(db, Owed, found) is True


def test_a_sender_that_raises_does_not_strand_its_claim(db):
    (row,) = _rows(db)

    def broken(rows):
        raise KeyError("payload field")

    report = deliver(db, _channel(broken))

    db.refresh(row)
    assert row.state == PENDING and row.claimed_at is None
    assert row.failures == 1 and "KeyError" in row.last_error
    assert report.retried == 1


def test_rows_sharing_a_batch_key_go_in_one_send(db):
    """M04 takes a candidate's observations as one list in one transaction."""
    rows = _rows(db, 3)
    rows[2].group = "b"
    db.add(rows[2])
    db.commit()
    sender = Recorder(Outcome.sent())

    deliver(db, _channel(sender, batch_key=lambda r: r.group))

    assert sorted(len(b) for b in sender.batches) == [1, 2]


def test_a_row_waiting_on_something_else_is_left_alone(db):
    """M06: an evaluation must not overtake the artifact it cites."""
    first, second = _rows(db, 2)

    def waits_on(_db):
        return lambda row: "artifact not delivered" if row.id == first.id else None

    report = deliver(db, _channel(Recorder(Outcome.sent()), waits_on=waits_on))

    db.refresh(first)
    assert first.state == PENDING and first.attempts == 0
    assert report.waiting == {"artifact not delivered": 1}
    assert report.sent == 1


def test_an_after_hook_that_raises_does_not_undo_a_delivery(db):
    (row,) = _rows(db)

    def after(_db, rows, outcome):
        raise RuntimeError("event log unavailable")

    deliver(db, _channel(Recorder(Outcome.sent()), after=after))
    db.refresh(row)
    assert row.state == SENT


# ─────────────────────────────────────────────────────────────────────────
#  Nothing stuck is invisible
# ─────────────────────────────────────────────────────────────────────────


def test_a_rejected_row_is_listed_with_its_reason(db):
    """M13's `/v1/outbox` answered `pending: 0, items: []` while a row sat
    rejected — the only way to read why was the database."""
    (row,) = _rows(db)
    deliver(db, _channel(Recorder(Outcome.reject("http_422: unknown concept"))))

    status = summary(db, Owed)

    assert status[REJECTED] == 1 and status["stuck"] == 1
    assert status["stuck_rows"][0]["last_error"] == "http_422: unknown concept"
    assert status["stuck_rows"][0]["id"] == str(row.id)
    assert status["errors"] == [{"error": "http_422: unknown concept", "rows": 1}]


def test_summary_says_how_long_the_oldest_owed_row_has_waited(db):
    (row,) = _rows(db)
    row.created_at = utcnow() - timedelta(minutes=5)
    db.add(row)
    db.commit()

    status = summary(db, Owed)

    assert status["owed"] == 1
    assert 295 <= status["oldest_owed_s"] <= 305


def test_requeue_resets_the_verdict_and_keeps_the_history(db):
    (row,) = _rows(db)
    row.state, row.failures, row.attempts = HELD, 3, 7
    db.add(row)
    db.commit()

    assert requeue(db, Owed) == 1

    db.refresh(row)
    assert (row.state, row.failures, row.attempts) == (PENDING, 0, 7)


def test_the_columns_can_be_added_to_a_table_that_predates_them(engine):
    """M13's outbox exists in every dev.db with five of these columns. Adding
    the rest must not cost anybody their local data."""

    class Legacy(OutboxRow, table=True):
        __tablename__ = "test_legacy_outbox"
        id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE test_legacy_outbox (id CHAR(32) PRIMARY KEY, state VARCHAR, "
                "attempts INTEGER, last_error VARCHAR, created_at DATETIME, sent_at DATETIME)"
            )
        )
        conn.execute(
            text("INSERT INTO test_legacy_outbox VALUES ('abc', 'pending', 2, NULL, "
                 "'2026-09-20 10:00:00', NULL)")
        )

    changes = ensure_schema(engine)

    added = {c.split(".")[-1].split()[0] for c in changes if "test_legacy_outbox" in c}
    assert {"failures", "claimed_at", "next_attempt_at"} <= added
    with engine.connect() as conn:
        failures = conn.execute(text("SELECT failures FROM test_legacy_outbox")).scalar()
    assert failures == 0


# ─────────────────────────────────────────────────────────────────────────
#  The worker
# ─────────────────────────────────────────────────────────────────────────


def test_a_sweep_runs_channels_in_declared_order(engine):
    """Order is a contract: the artifact goes before the evaluation citing it."""
    seen = []
    with Session(engine) as db:
        _rows(db, 1)

    def named(name):
        def send(rows):
            seen.append(name)
            return Outcome.sent()

        return Channel(name=name, model=Owed, send=send)

    sweeper = Sweeper("test", lambda: Session(engine), lambda: [named("first"), named("second")])
    reports = sweeper.sweep_once()

    assert [r.channel for r in reports] == ["first", "second"]
    assert seen == ["first"]  # one row, taken by the first channel
    assert sweeper.status()["last_sweep"][0]["sent"] == 1


def test_one_broken_channel_does_not_stop_the_rest(engine):
    with Session(engine) as db:
        _rows(db, 1)

    def broken_waits(_db):
        raise RuntimeError("cannot compute")

    channels = [
        Channel(name="broken", model=Owed, send=Recorder(Outcome.sent()), waits_on=broken_waits),
        Channel(name="fine", model=Owed, send=Recorder(Outcome.sent())),
    ]
    reports = Sweeper("test", lambda: Session(engine), channels).sweep_once()

    assert [r.channel for r in reports] == ["fine"]
    assert reports[0].sent == 1


def test_a_kick_sweeps_without_waiting_for_the_interval(engine):
    """A fresh row goes out when it is written, not up to an interval later."""
    with Session(engine) as db:
        _rows(db, 1)
    delivered = threading.Event()

    def send(rows):
        delivered.set()
        return Outcome.sent()

    sweeper = Sweeper(
        "test", lambda: Session(engine), [Channel(name="c", model=Owed, send=send)],
        interval_s=3600,
    )

    async def scenario():
        with sweeper.running():
            await asyncio.sleep(0.05)  # let the loop start and park on its timer
            sweeper.kick()
            for _ in range(100):
                if delivered.is_set():
                    return True
                await asyncio.sleep(0.02)
        return False

    assert asyncio.run(scenario()) is True


def test_kick_before_start_is_harmless():
    Sweeper("idle", lambda: None, []).kick()


def test_interval_zero_turns_it_off():
    async def scenario():
        with Sweeper("off", lambda: None, [], interval_s=0).running() as task:
            return task

    assert asyncio.run(scenario()) is None


# ─────────────────────────────────────────────────────────────────────────
#  HTTP
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (200, "sent"),
        (201, "sent"),
        (204, "sent"),
        (400, "reject"),
        (403, "reject"),
        (404, "reject"),
        (409, "reject"),
        (422, "reject"),
        (408, "retry"),
        (429, "retry"),
        (500, "retry"),
        (502, "unreachable"),
        (503, "unreachable"),
        (504, "unreachable"),
    ],
)
def test_status_classification(status, kind):
    assert classify_status(status).kind == kind


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - http.server's naming
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        code = int(body.get("answer", 201))
        payload = json.dumps(
            {"echo": body, "who": self.headers.get("X-Candidate-Id"),
             "agent": self.headers.get("User-Agent")}
        ).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def server():
    httpd = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def test_post_json_returns_the_parsed_body_on_success(server):
    outcome = post_json(f"{server}/x", {"answer": 201}, headers={"X-Candidate-Id": "c1"})
    assert outcome.kind == "sent"
    assert outcome.body["who"] == "c1"
    # Not `Python-urllib/3.x`, which Cloudflare answers with a 403 that reads
    # like a refusal.
    assert outcome.body["agent"].startswith("AI-Interviewer/")


def test_post_json_classifies_an_error_answer(server):
    assert post_json(f"{server}/x", {"answer": 422}).kind == "reject"
    assert post_json(f"{server}/x", {"answer": 503}).kind == "unreachable"


def test_post_json_to_nobody_is_unreachable_not_an_exception():
    outcome = post_json("http://127.0.0.1:9/x", {}, timeout=1.0)
    assert outcome.kind == "unreachable"
