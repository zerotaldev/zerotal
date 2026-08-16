---
title: Routing
description: Explicit routes, groups, file-based routes, model binding, domains, and testing.
---

# Routing

The router maps incoming HTTP requests to the controller that handles them.

## Named routes

Give a route a name and `route()` will build its URL for you, checked against the
generated name list so a typo is a compile error.

## Route model binding

A route parameter that matches a model's key arrives already resolved, so the
handler receives the record rather than an id.
