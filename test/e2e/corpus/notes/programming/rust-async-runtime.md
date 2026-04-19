---
title: Rust Async Runtime Internals
created: 2024-01-10T09:00:00.000Z
modified: 2024-01-10T09:00:00.000Z
tags: ["rust", "async", "tokio"]
type: note
---

Rust's async runtime model is fundamentally different from thread-based concurrency. Rather than spawning an OS thread per concurrent operation, Rust uses green threads managed by an executor — most commonly Tokio.

## The Future Trait

Every async function in Rust returns a type that implements `Future`. A `Future` is a state machine that the executor drives by repeatedly calling `poll`. The poll method returns either `Poll::Ready(value)` when the computation is complete, or `Poll::Pending` when the task needs to wait for an external event.

Unlike callback-based systems, Rust futures are lazy: nothing happens until an executor calls `poll`. This zero-cost abstraction means futures compile down to efficient state machines with no hidden allocations.

## Wakers and Task Scheduling

When a future returns `Poll::Pending`, it must register a `Waker` with whatever event source it is waiting on. When that event fires (e.g., a socket becomes readable), the event source calls `waker.wake()`, which signals the executor to reschedule the task and call `poll` again.

Tokio uses a multi-threaded work-stealing executor. Tasks are lightweight and cheap to spawn — Tokio can efficiently handle millions of concurrent tasks on a small thread pool. This is the core advantage of cooperative multitasking over preemptive OS threads.

## Tokio's Thread Pool

Tokio starts a pool of worker threads equal to the number of CPU cores. Each thread runs an event loop built on `epoll` (Linux) or `kqueue` (macOS). IO completion events are delivered to the appropriate waker, which wakes the sleeping task.

The `tokio::spawn` function sends a `Future` to the executor. Tasks are not pinned to a specific thread; the work-stealing scheduler moves tasks between threads to balance load.

## Blocking Operations

Because all threads run the executor event loop, blocking a Tokio thread stalls other tasks. CPU-bound or blocking I/O work should be dispatched with `tokio::task::spawn_blocking`, which runs the closure on a separate thread pool dedicated to blocking work.

## async/await Syntax

The `async` keyword transforms a function into one that returns a `Future`. The `await` keyword suspends the current task at a poll boundary, handing control back to the executor until the awaited future resolves. This cooperative yielding is what makes green threads efficient — no preemption overhead, no forced context switches.
