---
name: multi-sensor-triangulation-idea
description: Future feature idea — multiple PurpleAir sensors per location, averaged/triangulated
metadata:
  type: project
---

Future feature (requested 2026-06-16, not yet built): allow attaching **multiple
PurpleAir sensors to a single user-defined location**, then triangulate / average
them (or pick the best one) to produce that location's air-quality reading.

Current model (as of this change): each location holds at most ONE
`purpleair_sensor_index` and one `wu_station_id`. To support this, the location
shape and `fetchPurpleAir` in `lib/sources.mjs` would need to take a list of
sensor indices and combine their readings. See [[weather-compare-location-model]].
