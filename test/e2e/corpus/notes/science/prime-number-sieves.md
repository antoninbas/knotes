---
title: Prime Number Sieves
created: 2024-01-24T09:00:00.000Z
modified: 2024-01-24T09:00:00.000Z
tags: ["mathematics", "algorithms", "primes"]
type: note
---

A prime sieve is an algorithm for finding all prime numbers up to a limit by iteratively eliminating composite numbers. The classical algorithm is the Sieve of Eratosthenes; more advanced variants include the Sieve of Atkin and segmented sieves.

## Sieve of Eratosthenes

The simplest and most widely used prime sieve, with O(n log log n) time complexity.

**Algorithm**:
1. Create a boolean array of size `n+1`, all initialized to `true`.
2. Starting from `p = 2`, mark all multiples of `p` (starting from `p²`) as composite.
3. Move to the next unmarked number (the next prime) and repeat.
4. Stop when `p² > n`. All remaining `true` entries are prime.

```python
def sieve_of_eratosthenes(n):
    is_prime = [True] * (n + 1)
    is_prime[0] = is_prime[1] = False
    for p in range(2, int(n**0.5) + 1):
        if is_prime[p]:
            for i in range(p*p, n+1, p):
                is_prime[i] = False
    return [i for i, v in enumerate(is_prime) if v]
```

Memory usage is O(n) bits. For n = 10⁸, the boolean array fits in ~12 MB.

## Segmented Sieve

The standard sieve requires O(n) memory. A segmented sieve divides the range into blocks of size ~√n, finding primes in each segment using the small primes found in the first √n numbers. Memory usage drops to O(√n), making it practical for n up to 10¹².

## Sieve of Atkin

A more complex algorithm by Atkin and Bernstein (2004) that uses quadratic forms to mark composites. It has asymptotically better time complexity (O(n / log log n)) than Eratosthenes for large n, though in practice it is often slower due to constant factors and worse cache behavior.

The Sieve of Atkin is mainly of theoretical interest; the segmented Sieve of Eratosthenes is typically faster in practice.

## Linear Sieve

A variant that processes each composite exactly once, achieving O(n) time. It builds a "smallest prime factor" table alongside the primes. Useful when you need the full prime factorization of all numbers up to n.

## Applications

Prime sieves are used in cryptography (RSA key generation), competitive programming, and number theory research. Generating all primes up to 10⁷ takes ~100 ms with a naive sieve; optimized segmented sieves can enumerate primes up to 10¹² in minutes.
