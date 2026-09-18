You stopped, but this pull request has no verdict for the commit you were asked
to review.

Here is what the pull request says right now:

```
{{done_output}}
```

This is not a new instruction and it does not change your judgement. It is the
state of the pull request measured after you stopped, and it does not yet
satisfy the definition of done in your role instructions. Read them again,
submit the verdict, and then stop.

If you genuinely cannot tell, that is a real answer and a cheap one — put it in
`questions`, and it goes to a person. Silence is not an answer: it is the one
outcome the pipeline cannot act on.

You have a limited number of these. When they run out the run is recorded as a
failure and a human is asked to take over.
