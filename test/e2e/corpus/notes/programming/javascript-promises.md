---
title: JavaScript Promises and Async/Await
created: 2024-01-12T09:00:00.000Z
modified: 2024-01-12T09:00:00.000Z
tags: ["javascript", "async", "promises"]
type: note
---

Promises are the foundation of asynchronous programming in JavaScript. A Promise represents a value that may not be available yet — it is either pending, fulfilled (resolved), or rejected.

## Creating Promises

```javascript
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve("done"), 1000);
});
```

The executor function runs immediately and calls `resolve` or `reject` to settle the promise.

## Chaining with .then and .catch

`.then(onFulfilled, onRejected)` registers callbacks and returns a new Promise. `.catch(onRejected)` is shorthand for `.then(undefined, onRejected)`. Chains propagate values through each `.then`, and any thrown error jumps to the nearest `.catch`.

```javascript
fetch(url)
  .then(res => res.json())
  .then(data => process(data))
  .catch(err => console.error(err));
```

## Async/Await Syntax

The `async` keyword marks a function as returning a Promise. Inside an async function, `await` suspends execution until the awaited Promise settles.

```javascript
async function loadUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}
```

Errors from rejected promises become thrown exceptions, catchable with `try/catch`.

## Microtask Queue

Promise callbacks run as microtasks — they execute after the current synchronous code but before the next macrotask (like a `setTimeout` callback). This guarantees ordering: all `.then` callbacks for already-settled promises fire before the event loop returns to the task queue.

## Promise Combinators

- `Promise.all([...])` — resolves when all inputs resolve; rejects immediately if any rejects.
- `Promise.allSettled([...])` — resolves when all inputs settle, regardless of outcome.
- `Promise.race([...])` — settles with the first input to settle.
- `Promise.any([...])` — resolves with the first fulfilled input; rejects only if all reject.

## Common Mistakes

Forgetting to `return` inside a `.then` callback silently passes `undefined` to the next handler. Not catching rejections leads to unhandled rejection warnings. Nesting `.then` inside `.then` (the "Promise pyramid") defeats the point of chaining — flatten chains instead.
