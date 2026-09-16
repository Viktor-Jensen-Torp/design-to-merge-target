You stopped, but this pull request has no verdict for the commit you were asked
to review.

Here is what the pull request says right now:

```
{{done_output}}
```

This is not a new instruction and it does not change your judgement. It is the
state of the pull request measured after you stopped. Your role instructions
require one comment that begins `VERDICT:` and names the head SHA you reviewed;
a verdict naming an older commit is a verdict about code that has since changed.
Post it, then stop.

If you genuinely cannot tell, `VERDICT: unsure` is a real answer and a cheap
one. Silence is not — it is the one outcome the pipeline cannot act on.
