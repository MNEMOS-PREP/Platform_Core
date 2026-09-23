"""The transactional outbox: one implementation of "and a worker drains it".

Every module that owes another module something writes a row in the same
transaction as the work that caused it, and delivers it afterwards. That half
is easy and every module got it right. The other half is the worker, and it is
the half that went missing every time:

  * M13's `emit.py` said *"a row is written in the same transaction as the
    evaluation, and a worker drains it"*. There was no worker. Only
    `POST /outbox/drain`, which nothing called — so the platform's core loop
    closed on 2026-09-20 only because somebody drained it by hand.
  * M06 built one (`sweeper.py`) after its first live run left an answer queued
    for M13 with nobody left to retry it.
  * Twelve modules are not built yet, and each will owe somebody something.

So the mechanism lives here, once, and a module declares *what* it owes — a
table and a function that sends a batch — rather than re-deriving *how*.

── The lifecycle ───────────────────────────────────────────────────────────────

    pending ──claim──▶ sending ──▶ sent          delivered
                          │   ├──▶ void          nothing was owed after all
                          │   ├──▶ rejected      the upstream said no, for good
                          │   ├──▶ pending       unreachable: back off, and do NOT
                          │   │                  count it against the row
                          │   └──▶ pending/held  the upstream answered with an
                          │                      error: back off, count it, and
                          │                      hold it once it keeps happening
    held, rejected ──requeue──▶ pending

── Four decisions, each from a failure that already happened ───────────────────

**Claim before sending** (from M06). A row moves to `sending` by a conditional
UPDATE that commits before the network call, so a background task and a sweep
racing over one row cannot both post it. Without it one answer cost three
ensembles on M06's first live run. A claim expires, because a process that dies
mid-send must not strand its row.

**An outage is not the row's fault** (new). A row that exhausts its attempts
while the upstream is simply down is held for a reason that has nothing to do
with it, and then needs a human to notice the upstream came back. So
`unreachable` backs off without counting, and `held` keeps one meaning: *the
upstream is up and still will not take this* — which really does need a person.

**A circuit per pass** (new). When one send finds the upstream unreachable, the
rest of that channel's pass would fail the same way; they are left alone rather
than each burning an attempt and a timeout.

**Nothing stuck is invisible** (from M13's outbox). A rejected row used to drop
out of `/v1/outbox` entirely — `pending: 0`, `items: []` — and the only place to
read why was the database. `summary()` lists stuck rows with their errors,
because a row nobody can see is a row nobody fixes.

── What this deliberately does not do ──────────────────────────────────────────

It does not decide anything about a student. It moves facts that were already
decided, and every consumer's receiving side is idempotent (M04 inserts on
conflict-do-nothing, M02's ledger is append-only, M13 keys on `turn_id`), which
is what makes at-least-once delivery safe. It is not exactly-once and it does
not pretend to be.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Hashable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Generic, Literal, TypeVar

from sqlalchemy import and_, func, or_
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import update as sql_update
from sqlmodel import Field, Session, SQLModel, select

from ai_core.models import USER_AGENT
from ai_core.timeutil import as_utc, utcnow

__all__ = [
    "HELD",
    "OPEN_STATES",
    "PENDING",
    "REJECTED",
    "SENDING",
    "SENT",
    "STATES",
    "STUCK_STATES",
    "VOID",
    "Channel",
    "Outcome",
    "OutboxRow",
    "PassReport",
    "RetryPolicy",
    "Sweeper",
    "claim",
    "classify_status",
    "deliver",
    "due",
    "post_json",
    "requeue",
    "settle",
    "summary",
]

log = logging.getLogger(__name__)

PENDING = "pending"
SENDING = "sending"
SENT = "sent"
VOID = "void"
HELD = "held"
REJECTED = "rejected"

STATES = (PENDING, SENDING, SENT, VOID, HELD, REJECTED)
#: Still owed.
OPEN_STATES = (PENDING, SENDING)
#: Owed, and waiting on a person.
STUCK_STATES = (HELD, REJECTED)

#: `last_error` is for a human reading a status page, not an archive.
_ERROR_CHARS = 500


# ─────────────────────────────────────────────────────────────────────────
#  The row
# ─────────────────────────────────────────────────────────────────────────


class OutboxRow(SQLModel):
    """The delivery columns. Inherit it; declare your own key and payload.

    Not a table. A module writes::

        class CoverageOutbox(OutboxRow, table=True):
            __tablename__ = "m13_coverage_outbox"
            id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
            payload: dict = Field(default_factory=dict, sa_column=Column(JSON))

    The payload is not declared here because an `sa_column` is one Column
    object and a Column belongs to exactly one table.

    Every column has a default, so `ensure_schema()` can add them to a table
    that predates this class without a migration.
    """

    state: str = Field(default=PENDING, index=True)
    #: Every send tried, whatever came of it. Drives the backoff.
    attempts: int = 0
    #: Sends the upstream ANSWERED with an error. Drives `held`. An upstream
    #: that was down does not count — see the module docstring.
    failures: int = 0
    last_error: str | None = None
    created_at: datetime = Field(default_factory=utcnow, index=True)
    #: Set with `sending`, so a row abandoned by a crashed process can be told
    #: apart from one still in flight.
    claimed_at: datetime | None = None
    #: Not before this. NULL means now.
    next_attempt_at: datetime | None = None
    sent_at: datetime | None = None


R = TypeVar("R", bound=SQLModel)


# ─────────────────────────────────────────────────────────────────────────
#  What a send can come to
# ─────────────────────────────────────────────────────────────────────────

Kind = Literal["sent", "void", "reject", "retry", "unreachable"]


@dataclass(frozen=True)
class Outcome:
    """What happened to one send. A sender returns one; it never raises.

    `body` carries the upstream's parsed answer for a caller that needs it —
    M06 records M13's status as an event — and takes no part in equality.
    """

    kind: Kind
    detail: str = ""
    body: Any = field(default=None, compare=False)

    @classmethod
    def sent(cls, detail: str = "", body: Any = None) -> Outcome:
        return cls("sent", detail, body)

    @classmethod
    def void(cls, reason: str) -> Outcome:
        """Nothing was owed. Terminal, and not an error."""
        return cls("void", reason)

    @classmethod
    def reject(cls, detail: str) -> Outcome:
        """The upstream will never take this as it is. A 4xx."""
        return cls("reject", detail)

    @classmethod
    def retry(cls, detail: str) -> Outcome:
        """The upstream answered and failed. It may not next time."""
        return cls("retry", detail)

    @classmethod
    def unreachable(cls, detail: str) -> Outcome:
        """Nobody answered. Says nothing about the row."""
        return cls("unreachable", detail)

    @property
    def ok(self) -> bool:
        return self.kind in ("sent", "void")


def classify_status(status: int, body: str = "") -> Outcome:
    """One reading of an HTTP status, so nineteen modules do not each guess.

    502/503/504 are the upstream's front door saying the service behind it is
    not there — unreachable, not the row's fault. 408/425/429 and the other
    5xx are an answer that might change. Every other 4xx will not.
    """
    detail = f"http_{status}" + (f": {body[:300]}" if body else "")
    if 200 <= status < 300:
        return Outcome.sent(f"http_{status}")
    if status in (502, 503, 504):
        return Outcome.unreachable(detail)
    if status in (408, 425, 429) or status >= 500:
        return Outcome.retry(detail)
    return Outcome.reject(detail)


def post_json(
    url: str,
    payload: Any,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
    method: str = "POST",
) -> Outcome:
    """Send JSON and classify the answer. Never raises.

    Standard library only, because this package must not choose an HTTP
    client for nineteen modules, and because a sweep runs in a worker thread
    where a synchronous call is exactly right.
    """
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method=method,
        # The platform's agent string, not urllib's: a default
        # `Python-urllib/3.x` is answered 403 by anything behind Cloudflare,
        # and that 403 reads exactly like a refusal (README, v0.3.0).
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            raw = response.read().decode("utf-8", "replace")
            outcome = classify_status(response.status)
            try:
                parsed = json.loads(raw) if raw else None
            except ValueError:
                parsed = raw
            return Outcome(outcome.kind, outcome.detail, parsed)
    except urllib.error.HTTPError as exc:
        return classify_status(exc.code, exc.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        return Outcome.unreachable(f"{type(exc).__name__}: {reason}")
    except Exception as exc:  # noqa: BLE001 - a transport surprise is a retry, not a crash
        return Outcome.retry(f"{type(exc).__name__}: {exc}")


# ─────────────────────────────────────────────────────────────────────────
#  Policy
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RetryPolicy:
    """When to try again, and when to stop and hold.

    The defaults retry at ~15 s, 30 s, 1 min, 2 min … capped at 10 min. The cap
    is short on purpose: a row waiting out an outage is found by the next
    attempt after the upstream returns, so the cap IS the worst-case delay
    after recovery. Ten minutes of a demo is already too long; an hour would
    look like a lost score.
    """

    base_s: float = 15.0
    factor: float = 2.0
    cap_s: float = 600.0
    #: Answered failures before a row is held for a person.
    max_failures: int = 5
    #: A claim older than this belonged to a process that is not coming back.
    #: Longer than any sender's own timeout, so a slow send is never stolen.
    stale_claim_s: float = 180.0
    #: ± this fraction, so a fleet of rows that failed together does not
    #: retry together.
    jitter: float = 0.2

    def delay_s(self, attempts: int, rng: Callable[[], float] = random.random) -> float:
        raw = min(self.cap_s, self.base_s * self.factor ** max(0, attempts - 1))
        if self.jitter:
            raw *= 1.0 + self.jitter * (2.0 * rng() - 1.0)
        return max(0.0, raw)


# ─────────────────────────────────────────────────────────────────────────
#  A channel: one table, one destination
# ─────────────────────────────────────────────────────────────────────────


@dataclass
class Channel(Generic[R]):
    """What a module owes one upstream, declared rather than re-implemented.

    `send` takes a batch and returns ONE outcome for it, because the upstreams
    that take lists (M04's observations) take them in one transaction — all or
    nothing. A destination that takes one row at a time leaves `batch_key`
    unset and gets batches of one.

    `waits_on`, when given, is called once per pass and returns a predicate
    that names why a row must not go yet — M06's evaluation waits for its
    artifact, because M04 refuses evidence it cannot resolve. A waiting row is
    not claimed and not counted; it is simply not due.
    """

    name: str
    model: type[R]
    send: Callable[[list[R]], Outcome]
    batch_key: Callable[[R], Hashable] | None = None
    waits_on: Callable[[Session], Callable[[R], str | None]] | None = None
    #: Told what happened after each batch is settled. Must not raise; if it
    #: does, the failure is logged and the delivery stands.
    after: Callable[[Session, list[R], Outcome], None] | None = None
    policy: RetryPolicy = field(default_factory=RetryPolicy)
    limit: int = 100


@dataclass
class PassReport:
    """One channel, one pass."""

    channel: str
    sent: int = 0
    void: int = 0
    retried: int = 0
    held: int = 0
    rejected: int = 0
    #: Rows put back because nobody answered.
    deferred: int = 0
    #: True when a send found the upstream down and the pass stopped there.
    circuit_open: bool = False
    #: Rows another sender holds. Not a failure — "wait a moment".
    in_flight: int = 0
    #: reason -> rows not sent because something must land first.
    waiting: dict[str, int] = field(default_factory=dict)

    @property
    def moved(self) -> int:
        return self.sent + self.void

    def as_dict(self) -> dict[str, Any]:
        return {
            "channel": self.channel,
            "sent": self.sent,
            "void": self.void,
            "retried": self.retried,
            "held": self.held,
            "rejected": self.rejected,
            "deferred": self.deferred,
            "circuit_open": self.circuit_open,
            "in_flight": self.in_flight,
            "waiting": dict(self.waiting),
        }


# ─────────────────────────────────────────────────────────────────────────
#  The mechanism
# ─────────────────────────────────────────────────────────────────────────


def _pk(model: type[SQLModel], row: SQLModel):
    """`WHERE <primary key> = <this row's>`, whatever the key is called."""
    columns = sa_inspect(model).primary_key
    return and_(*[column == getattr(row, column.key) for column in columns])


def due(
    db: Session,
    model: type[R],
    *,
    now: datetime | None = None,
    policy: RetryPolicy | None = None,
    limit: int = 100,
    where: Any = None,
) -> list[R]:
    """Rows nobody is sending and whose backoff has passed, oldest first.

    A row claimed by a sender that went quiet longer than `stale_claim_s` ago
    counts as nobody's.
    """
    now = now or utcnow()
    policy = policy or RetryPolicy()
    stale = now - timedelta(seconds=policy.stale_claim_s)
    statement = select(model).where(
        or_(
            and_(
                model.state == PENDING,
                or_(model.next_attempt_at.is_(None), model.next_attempt_at <= now),
            ),
            and_(model.state == SENDING, model.claimed_at < stale),
        )
    )
    if where is not None:
        statement = statement.where(where)
    return list(db.exec(statement.order_by(model.created_at).limit(limit)).all())


def claim(
    db: Session,
    model: type[R],
    row: R,
    *,
    now: datetime | None = None,
) -> bool:
    """Take this row for sending. False when another sender got there first.

    The UPDATE carries a WHERE on the state we read, so the database — not this
    process's memory of it — decides who owns the row. A queued row is claimed
    by its state; a stale claim is taken over by matching that claim's exact
    timestamp, so two sweeps reclaiming one abandoned row cannot both win.
    Commits before returning, which is what makes the claim visible to them.
    """
    now = now or utcnow()
    statement = sql_update(model).where(_pk(model, row))
    if row.state == PENDING:
        statement = statement.where(model.state == PENDING)
    else:
        statement = statement.where(model.state == SENDING).where(
            model.claimed_at == row.claimed_at
        )
    result = db.execute(statement.values(state=SENDING, claimed_at=now))
    if not result.rowcount:
        db.rollback()
        return False
    db.commit()
    db.refresh(row)
    return True


def settle(
    row: SQLModel,
    outcome: Outcome,
    *,
    now: datetime | None = None,
    policy: RetryPolicy | None = None,
    rng: Callable[[], float] = random.random,
) -> str:
    """Write what happened onto the row. Returns its new state. Does not commit."""
    now = now or utcnow()
    policy = policy or RetryPolicy()
    row.attempts = (row.attempts or 0) + 1
    row.claimed_at = None

    if outcome.kind == "sent":
        row.state, row.sent_at, row.last_error, row.next_attempt_at = SENT, now, None, None
    elif outcome.kind == "void":
        # Kept as the reason, not as an error: "no ledger for this turn" is a
        # true answer somebody reading the status page may want.
        row.state, row.sent_at, row.next_attempt_at = VOID, now, None
        row.last_error = outcome.detail[:_ERROR_CHARS] or None
    elif outcome.kind == "reject":
        row.state, row.next_attempt_at = REJECTED, None
        row.last_error = outcome.detail[:_ERROR_CHARS]
    elif outcome.kind == "retry":
        row.failures = (row.failures or 0) + 1
        row.last_error = outcome.detail[:_ERROR_CHARS]
        if row.failures >= policy.max_failures:
            row.state, row.next_attempt_at = HELD, None
        else:
            row.state = PENDING
            row.next_attempt_at = now + timedelta(seconds=policy.delay_s(row.attempts, rng))
    else:  # unreachable
        row.state = PENDING
        row.last_error = outcome.detail[:_ERROR_CHARS]
        row.next_attempt_at = now + timedelta(seconds=policy.delay_s(row.attempts, rng))
    return row.state


def deliver(
    db: Session,
    channel: Channel[R],
    *,
    now: datetime | None = None,
    limit: int | None = None,
    where: Any = None,
) -> PassReport:
    """One pass over one channel. Never raises: a failure is a row, not an outage.

    `where` narrows the pass — M06 drains one session's rows on the request that
    produced them, and leaves the rest to the sweep.
    """
    now = now or utcnow()
    report = PassReport(channel=channel.name)
    rows = due(
        db,
        channel.model,
        now=now,
        policy=channel.policy,
        limit=limit or channel.limit,
        where=where,
    )
    if not rows:
        return report

    blocked = channel.waits_on(db) if channel.waits_on else None
    batches: dict[Hashable, list[R]] = {}
    for index, row in enumerate(rows):
        reason = blocked(row) if blocked else None
        if reason:
            report.waiting[reason] = report.waiting.get(reason, 0) + 1
            continue
        key = channel.batch_key(row) if channel.batch_key else index
        batches.setdefault(key, []).append(row)

    for batch in batches.values():
        claimed = [row for row in batch if claim(db, channel.model, row, now=now)]
        report.in_flight += len(batch) - len(claimed)
        if not claimed:
            continue
        try:
            outcome = channel.send(claimed)
        except Exception as exc:  # noqa: BLE001 - a sender bug must not strand its claim
            log.warning("outbox %s: sender raised", channel.name, exc_info=True)
            outcome = Outcome.retry(f"sender raised {type(exc).__name__}: {exc}")

        for row in claimed:
            state = settle(row, outcome, now=now, policy=channel.policy)
            db.add(row)
            _tally(report, outcome, state)
        db.commit()

        if channel.after is not None:
            try:
                channel.after(db, claimed, outcome)
            except Exception:  # noqa: BLE001 - the delivery happened; say so and go on
                log.warning("outbox %s: after-hook raised", channel.name, exc_info=True)

        if outcome.kind == "unreachable":
            # The rest of this pass would find the same closed door, each at
            # the cost of a timeout. Leave them due; the next pass asks again.
            report.circuit_open = True
            break

    if report.sent and not report.circuit_open:
        _rearm(db, channel.model, now=now, where=where)
    return report


def _tally(report: PassReport, outcome: Outcome, state: str) -> None:
    if outcome.kind == "sent":
        report.sent += 1
    elif outcome.kind == "void":
        report.void += 1
    elif outcome.kind == "reject":
        report.rejected += 1
    elif outcome.kind == "unreachable":
        report.deferred += 1
    elif state == HELD:
        report.held += 1
    else:
        report.retried += 1


def _rearm(db: Session, model: type[SQLModel], *, now: datetime, where: Any = None) -> int:
    """The upstream just took something: stop waiting out old backoffs.

    Rows deferred during an outage carry backoffs of up to `cap_s`. Once one
    send gets through, the door is open again, and making the rest wait out
    timers set while it was shut is a delay that protects nothing.
    """
    statement = (
        sql_update(model)
        .where(model.state == PENDING)
        .where(model.next_attempt_at.is_not(None))
        .where(model.next_attempt_at > now)
    )
    if where is not None:
        statement = statement.where(where)
    result = db.execute(statement.values(next_attempt_at=None))
    db.commit()
    return result.rowcount or 0


def requeue(
    db: Session,
    model: type[SQLModel],
    *,
    states: Sequence[str] = STUCK_STATES,
    where: Any = None,
) -> int:
    """Put stuck rows back in the queue — after a person fixed the cause.

    Resets `failures` (the evidence that held it is about a cause that has
    been dealt with) and keeps `attempts` (the history is still true).
    """
    statement = sql_update(model).where(model.state.in_(tuple(states)))
    if where is not None:
        statement = statement.where(where)
    result = db.execute(
        statement.values(state=PENDING, failures=0, next_attempt_at=None, claimed_at=None)
    )
    db.commit()
    return result.rowcount or 0


def summary(
    db: Session,
    model: type[SQLModel],
    *,
    now: datetime | None = None,
    where: Any = None,
    describe: Callable[[Any], dict[str, Any]] | None = None,
    stuck_limit: int = 20,
) -> dict[str, Any]:
    """Counts by state, how long the oldest owed row has waited, and every
    stuck row with its reason.

    `describe` turns a stuck row into the fields worth showing (an id, a
    concept); without it the primary key is shown.
    """
    now = now or utcnow()
    counts_q = select(model.state, func.count()).group_by(model.state)
    if where is not None:
        counts_q = counts_q.where(where)
    counts = dict.fromkeys(STATES, 0)
    for state, n in db.exec(counts_q).all():
        counts[state] = n

    open_q = select(model).where(model.state.in_(OPEN_STATES))
    if where is not None:
        open_q = open_q.where(where)
    oldest = db.exec(open_q.order_by(model.created_at).limit(1)).first()
    next_q = open_q.where(model.next_attempt_at.is_not(None)).order_by(model.next_attempt_at)
    upcoming = db.exec(next_q.limit(1)).first()

    stuck_q = select(model).where(model.state.in_(STUCK_STATES))
    if where is not None:
        stuck_q = stuck_q.where(where)
    stuck = db.exec(stuck_q.order_by(model.created_at).limit(stuck_limit)).all()

    errors_q = (
        select(model.last_error, func.count())
        .where(model.state.in_(OPEN_STATES + STUCK_STATES))
        .where(model.last_error.is_not(None))
        .group_by(model.last_error)
        .order_by(func.count().desc())
        .limit(5)
    )
    if where is not None:
        errors_q = errors_q.where(where)

    def _describe(row: Any) -> dict[str, Any]:
        base = (
            describe(row)
            if describe
            else {
                column.key: str(getattr(row, column.key))
                for column in sa_inspect(model).primary_key
            }
        )
        return {
            **base,
            "state": row.state,
            "attempts": row.attempts,
            "failures": row.failures,
            "last_error": row.last_error,
        }

    return {
        **counts,
        "owed": counts[PENDING] + counts[SENDING],
        "stuck": counts[HELD] + counts[REJECTED],
        "oldest_owed_s": (
            round((now - as_utc(oldest.created_at)).total_seconds(), 1) if oldest else None
        ),
        "next_retry_in_s": (
            round(max(0.0, (as_utc(upcoming.next_attempt_at) - now).total_seconds()), 1)
            if upcoming
            else None
        ),
        "errors": [{"error": error, "rows": n} for error, n in db.exec(errors_q).all()],
        "stuck_rows": [_describe(row) for row in stuck],
    }


# ─────────────────────────────────────────────────────────────────────────
#  The worker
# ─────────────────────────────────────────────────────────────────────────

SessionFactory = Callable[[], Session]
Channels = Sequence[Channel[Any]] | Callable[[], Sequence[Channel[Any]]]


class Sweeper:
    """Delivers every channel, forever, off the event loop.

    Sweeps every `interval_s`, and sooner when `kick()`ed: the route that wrote
    a row kicks, so a fresh row goes out in milliseconds while the interval is
    only the safety net for the ones that failed. Polling fast instead would
    trade idle load for latency; waiting for the interval would make a score
    arrive up to half a minute after the answer.

    Channels are resolved per sweep when given as a callable, so an upstream
    whose URL or key changed is used on the next sweep without a restart.

    Off in tests: the suite never starts a lifespan, and `sweep_once` is a
    plain function so the behaviour is testable without a loop at all.
    """

    def __init__(
        self,
        name: str,
        session_factory: SessionFactory,
        channels: Channels,
        *,
        interval_s: float = 30.0,
    ) -> None:
        self.name = name
        self.session_factory = session_factory
        self._channels = channels
        self.interval_s = interval_s
        self.last: list[PassReport] = []
        self.last_at: datetime | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wake: asyncio.Event | None = None
        self._lock = threading.Lock()

    def channels(self) -> Sequence[Channel[Any]]:
        return self._channels() if callable(self._channels) else self._channels

    def sweep_once(self) -> list[PassReport]:
        """Every channel, in declared order — order is a contract (artifact
        before the evaluation that cites it). Never raises."""
        if not self._lock.acquire(blocking=False):
            return []  # a sweep is already running; it will see these rows
        try:
            reports: list[PassReport] = []
            for channel in self.channels():
                try:
                    with self.session_factory() as db:
                        reports.append(deliver(db, channel))
                except Exception:  # noqa: BLE001 - one broken channel must not stop the rest
                    log.warning(
                        "%s sweep: channel %s failed", self.name, channel.name, exc_info=True
                    )
            self.last, self.last_at = reports, utcnow()
            moved = sum(r.moved for r in reports)
            stuck = sum(r.held + r.rejected for r in reports)
            if moved or stuck:
                log.info("%s sweep: %d delivered, %d newly stuck", self.name, moved, stuck)
            return reports
        finally:
            self._lock.release()

    def kick(self) -> None:
        """Sweep now rather than at the next interval. Safe from any thread."""
        loop, wake = self._loop, self._wake
        if loop is None or wake is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(wake.set)

    def status(self) -> dict[str, Any]:
        return {
            "running": self._loop is not None,
            "interval_s": self.interval_s,
            "last_sweep_at": self.last_at.isoformat() if self.last_at else None,
            "last_sweep": [r.as_dict() for r in self.last],
        }

    async def run_forever(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self.interval_s)
            self._wake.clear()
            try:
                await asyncio.to_thread(self.sweep_once)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - the sweeper outlives its failures
                log.warning(
                    "%s sweep failed; the next one will try again", self.name, exc_info=True
                )

    @contextlib.contextmanager
    def running(self) -> Iterator[asyncio.Task | None]:
        """Start for the life of the app, stop on shutdown. Call inside a
        lifespan. `interval_s <= 0` turns it off — what a demo showing the
        queue fill up wants."""
        if self.interval_s <= 0:
            log.info("%s outbox sweeper off (interval %s)", self.name, self.interval_s)
            yield None
            return
        task = asyncio.get_running_loop().create_task(self.run_forever())
        log.info("%s outbox sweeper on — every %.0fs, and on kick", self.name, self.interval_s)
        try:
            yield task
        finally:
            task.cancel()
            self._loop = self._wake = None
