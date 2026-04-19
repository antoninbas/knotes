---
title: Dev Journal
created: 2024-01-01T08:00:00.000Z
modified: 2024-03-01T08:00:00.000Z
tags: ["dev", "journal"]
type: log
---

## 2024-02-28T14:00:00.000Z {#e-d001000000000001}

Traced a subtle Rust lifetime bug today. The issue was that a reference to a temporary was being held across an await point. The fix was to clone the value before the async block. Lifetimes and async in Rust interact in non-obvious ways because the compiler cannot allow references to live in the state machine across suspension points if they point to stack memory that may not exist when the task resumes.

## 2024-02-25T10:00:00.000Z {#e-d001000000000002}

Spent the morning profiling a slow database query. The culprit was a missing index on the foreign key column in a JOIN. Adding the index dropped query time from 800ms to 12ms. EXPLAIN ANALYZE in PostgreSQL is invaluable — always run it before assuming you know where the bottleneck is.

## 2024-02-20T09:30:00.000Z {#e-d001000000000003}

Learned about Go's `sync.Map` today. It is designed for cases where entries are written once and read many times, or when goroutines access disjoint keys. For most use cases, a regular map with a `sync.RWMutex` is simpler and more flexible. The sync.Map documentation explicitly says it should not be used as a general-purpose concurrent map replacement.

## 2024-02-15T16:00:00.000Z {#e-d001000000000004}

Debugged a race condition in a Node.js service. Two async functions were both checking-and-then-setting a value in Redis without a lock. The fix was a Lua script in Redis that performs the check-and-set atomically. Redis processes Lua scripts in a single-threaded atomic operation — no interleaving is possible.

## 2024-02-10T11:00:00.000Z {#e-d001000000000005}

Explored WebAssembly (Wasm) for running compute-intensive code in the browser. The main insight: Wasm does not automatically make code faster than JavaScript for most tasks. It shines when: (1) porting existing C/C++/Rust code, (2) running tight numeric loops that the JS JIT cannot optimize as well, (3) avoiding GC pauses in latency-sensitive code.

## 2024-02-05T13:00:00.000Z {#e-d001000000000006}

Investigated CSS container queries. Unlike media queries that respond to the viewport, container queries respond to the parent container's size. This makes reusable components truly self-contained — the component adapts to its context, not the global viewport. Browser support is now strong enough for production use.

## 2024-01-30T09:00:00.000Z {#e-d001000000000007}

Learned that Python's `asyncio.gather` runs coroutines concurrently but not in parallel (still single-threaded). For CPU-bound work, you need `ProcessPoolExecutor` via `loop.run_in_executor`. The distinction between concurrency (managing multiple tasks) and parallelism (running them simultaneously on multiple cores) is often blurred in Python documentation.

## 2024-01-25T14:30:00.000Z {#e-d001000000000008}

Discovered the `git bisect` command properly today. Binary search through commits to find the one that introduced a bug. Start with `git bisect start`, mark the bad commit, mark a known good commit, and then run your test script. Git checks out the midpoint commit each time. Saves enormous time compared to manually checking commits.

## 2024-01-20T10:00:00.000Z {#e-d001000000000009}

Explored eBPF for observability. Linux's eBPF allows attaching small sandboxed programs to kernel events (system calls, network packets, function calls) without kernel modules or reboots. Tools like Cilium, Falco, and bpftrace are built on it. The main limitation is the verifier — programs must be provably terminating and memory-safe.

## 2024-01-15T08:00:00.000Z {#e-d001000000000010}

Fixed a memory leak in a C++ application. The issue was a `shared_ptr` cycle: object A held a `shared_ptr` to B, and B held a `shared_ptr` back to A. Neither reference count ever reached zero. The fix was to make one of the back-pointers a `weak_ptr`. The `weak_ptr` does not increment the reference count and must be promoted to `shared_ptr` before use.
