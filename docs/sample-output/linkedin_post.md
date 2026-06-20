# LinkedIn post — sample (illustrative)

_English. Review, tweak the voice, then post with the carousel PNGs._

## Post

```
Everyone keeps asking when transformers "end." Watching this week's state-space
results, I think that's the wrong question.

The interesting shift isn't replacing attention — it's putting it on a budget.
Pure SSMs give you linear-time inference and constant memory per token, which is
exactly what you want past ~100k tokens. They just pay for it with weaker exact
recall. The hybrids that are showing up keep a handful of attention layers to buy
that recall back, and spend the rest on cheap recurrence.

That framing — attention as a scarce resource you allocate, not a default you
apply everywhere — is the part I'll be watching. It changes how you'd design for
long documents, codebases, and agent traces.

Curious where I'm wrong: is exact retrieval at long context a solved problem with
hybrids, or still the real bottleneck?

#MachineLearning #LLM #StateSpaceModels #AIResearch
```

## Carousel outline

**Cover:** Post-Transformer Models Are Getting Real — _What this week's state-space results mean for long-context inference_

1. **The bottleneck** — Attention is quadratic in sequence length. Past ~100k tokens, that cost dominates everything else.
2. **State-space idea** — SSMs carry a fixed-size recurrent state, giving linear-time inference and constant memory per token.
3. **Why it matters** — Linear scaling unlocks document-, codebase-, and agent-trace-length contexts without exploding cost.
4. **The catch** — Pure SSMs can lag on exact recall. Hybrids interleave a few attention layers to recover it.

**Outro:** Follow along — I write a short, source-checked AI brief most days.
