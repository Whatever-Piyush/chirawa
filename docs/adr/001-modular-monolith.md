# ADR 001 — Modular Monolith Architecture

**Date:** 2024  
**Status:** Accepted  
**Deciders:** Founders

## Context

We are building a quick-commerce platform for Chirawa (population ~60,000)
targeting 500 orders/day at maturity. We have a 2-person development team.

## Decision

We build a **modular monolith** — one deployable Node.js application with
strict internal module boundaries — rather than microservices.

## Rationale

Microservices introduce:
- Distributed transaction complexity (order + payment + inventory updates
  that must be atomic become a distributed saga problem)
- Multi-service deployment overhead
- Cross-service observability burden (tracing spans across services)
- Network latency between services on every request

None of these tradeoffs deliver benefit at 500 orders/day on a 2-person team.

A well-structured modular monolith on a single powerful server handles every
workload this platform will see until well past 1,000 orders/day.

## Module Boundary Enforcement

ESLint `no-restricted-imports` rules prevent direct cross-module imports.
All cross-module access goes through each module's exported service interface.
This is enforced in CI — violations block merge.

## Consequences

- Simple deployment (one Docker image, PM2 cluster)
- Simple observability (one log stream, one Sentry project)
- Simple local development (docker-compose up, one process)
- Future extraction: if a module's scaling profile genuinely diverges,
  it peels off into its own process. The boundary is already there.