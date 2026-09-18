You stopped without calling submit_refinement, so nothing from this run is recorded.

```
{{done_output}}
```

This is not a new instruction. Call submit_refinement now with your decisions. If
nothing needs refining, call it with an empty issues list. That is a correct
outcome, and it still has to be recorded.

You have a limited number of these. When they run out, the run fails and nothing
from it is applied.
