---
title: Casts & Mutators
description: Translate between raw database values and rich, typed TypeScript values.
---

# Casts & Mutators

Casts translate between the raw value stored in the database and the typed value
your model exposes.

## Datetime casts

A datetime column is cast to a Carbon instance on read and serialised back on
write.
