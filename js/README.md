# Rules for modules in this directory

## 1. What a new module is allowed to cost

A new module ships only if it is:

- (a) derived from data already stored, or
- (b) automatically fed by a sync, or
- (c) exactly one tap per logged event — never typing.

Anything that adds a new daily typing obligation is rejected.

This is a guard rail against dashboard creep: every tracker that asks for
a few seconds of manual entry each day is a few seconds someone has to
spend every single day, forever, or the tracker quietly goes stale and
starts lying. Modules that are pure readouts (heatmap, countdown, the
morning briefing) or a single tap (dismissing a nudge, drinking a
bottle) don't have that cost. A text field does.

This does not apply to the core Today/Plan Tomorrow goal lists — typing
a task is the entire point of a to-do app, not an auxiliary tax layered
on top of one. The rule is aimed at trackers that get added *alongside*
the app's actual job, not the job itself.

## 2. Correlation panels are observations, not findings

Any panel anywhere that relates two tracked things (sleep vs goal
completion, water vs distance, or anything similar added later) must be
worded as an observation over a stated sample, never as a cause:

> Over the last N days with data: X on days after 7h+ sleep, Y below.

Never "sleeping more makes you more productive." Show the sample size.
Suppress the panel entirely when N is under 21 — a few weeks of
self-reported data gives patterns worth noticing, not findings, and the
interface should say so rather than implying more confidence than the
sample supports.

No such panel exists yet in this codebase — this rule is a no-op today,
written down for whenever one gets built.
