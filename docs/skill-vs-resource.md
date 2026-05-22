# Skills vs Resources: Classification Guide

## The Rule

For every piece of domain content, ask two questions:

| Question | If YES | Destination |
|----------|--------|-------------|
| Does this describe **WHAT** something IS? | Resource | `/workspace/docs/` |
| Does this describe **HOW** the agent should BEHAVE? | Skill | `/workspace/.claude/skills/` |
| Contains both? | Split the file | Facts -> resource, Instructions -> skill |

## Examples

### This is a RESOURCE (knowledge):
```markdown
# Service Charge Policy

Service charge is a fee charged to end-users for transactions.

Types:
- Flat fee: fixed amount (e.g., $0.50 per txn)
- Percentage: % of transaction amount (e.g., 1.5%)
- Tiered: different rates based on amount ranges
```
**Why:** It describes WHAT a service charge is. It's factual, reusable, and the same regardless of which agent reads it.

### This is a SKILL (behavior):
```markdown
# How to Debug Pricing Issues

1. First check which policies are active for the transaction type
2. Verify policy evaluation order: service_charge -> commission -> tax -> discount
3. NEVER modify pricing configs without explicit approval
4. Always show before/after calculations when suggesting a fix
```
**Why:** It describes HOW the agent should act. It's instructional, agent-specific, and changes the agent's behavior.

### This needs SPLITTING:
```markdown
# Commission Policy Guide

## What is Commission (RESOURCE)
Commission defines earnings for agents/merchants per transaction.
Split: Super Agent 40%, Agent 50%, Platform 10%.
Settlement: real-time or batched.

## How to Investigate Commission Issues (SKILL)
1. Check if the commission split adds up to 100%
2. Verify settlement frequency matches the agent's contract
3. Always escalate if the discrepancy is > $100
```

Split into:
- `docs/pricing/commission.md` (the "What" section)
- `.claude/skills/investigate-commission.md` (the "How" section)

## Migration Checklist

When converting an existing `.claude/skills/` folder (mixed content):

```
For each file:
  ├── Pure knowledge/facts?
  │     -> Move to docs/ (becomes a resource)
  │
  ├── Pure behavior instructions?
  │     -> Keep in .claude/skills/ (stays a skill)
  │
  └── Mixed?
        -> Split into two files
        -> Facts -> docs/
        -> Instructions -> .claude/skills/
```
