# CareTrace — who to call first after discharge

A discharge-coordination decision-support demo. CareTrace ranks today's discharged
patients by **where one coordinator-hour prevents the most 30-day readmissions** —
an XGBoost risk score, a rules layer that matches eligible interventions, a
knapsack optimizer that spends a fixed coordinator budget, an LLM that only
phrases discharge text, and a clinician who approves every flag.

**System rule (footer of the app, and here):**
> ML scores. Rules recommend. The optimizer prioritizes. The LLM only phrases.
> A clinician approves.

---

## Quick start (clean machine, one command each)

```bash
make setup    # python deps + frontend npm install
make train    # XGBoost + isotonic calibration + SHAP  -> artifacts/
make seed     # SQLite: 69,990 patients, 13,998 predictions, 60-patient demo cohort
make run      # API on http://127.0.0.1:8000  + UI on http://localhost:5173
```

Optional:

```bash
make replay   # 200-day offline backtest -> artifacts/replay.json
make test     # 16 tests (split integrity, no-leak, budget, 403, fallback)
make ui       # frontend production build
```

> **Windows note:** `make` comes from GnuWin32 Make. In a fresh PowerShell,
> refresh PATH first if `make` is not found:
> `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

Then open **http://localhost:5173** — the role switcher in the header toggles
between `coordinator` (view + task updates only) and `clinician` (approve / edit
reject).

---

## What the numbers are (all computed — regenerate with `python scripts/demo_numbers.py`)

### Model (held-out test split, `artifacts/metrics.json`)

| | |
|---|---|
| ROC-AUC | **0.651** (untuned, honest) |
| PR-AUC | **0.175** (base rate 9.2%) |
| Top-20% capture | **36.4%** of true readmissions land in the top quintile by risk |
| High-risk cutoff | **11.31%** calibrated risk → 3,712 / 13,998 test rows flagged (isotonic ties make this >20%, documented in metrics notes) |
| Patients after filters | 69,990 from 101,766 rows (first encounter per patient, expired/hospice dispositions excluded) |
| Split | patient-level 60/20/20 → 41,994 / 13,998 / 13,998, **zero patient overlap** (tested) |
| Features | 101 — `readmitted` is never an input (tested) |

### Replay backtest (`artifacts/replay.json`, 200 days × 60 patients, 4 h budget)

| policy | readmissions reached (mean, p10–p90) | expected avoided (mean, p10–p90) |
|---|---|---|
| chronological | 1.35 (0.0–3.0) | 0.16 (0.0–0.4) |
| raw risk | 1.85 (0.0–3.0) | **0.21** (0.0–0.4) |
| **caretrace** | 1.50 (0.0–3.0) | 0.17 (0.0–0.4) |
| human (simulated) | 1.26 (0.0–3.0) | 0.15 (0.0–0.3) |

**Loud warning (fires in the UI, verbatim):**
> ⚠ WARNING: CareTrace did NOT beat raw risk on expected avoided readmissions
> (0.17 vs 0.21 mean over 200 days). Adjust the pitch: report metric 1 (real
> readmissions reached) and note metric 2 depends on ASSUMED effects.

This is the system being honest with itself: CareTrace beats *chronological* and
*human* ordering, but **raw risk wins metric 2** on this dataset. Metric 2 also
multiplies true labels by *assumed* effect sizes — an assumption, not a
prediction. Every surface that shows an effect size carries the tag
**“assumption, not a prediction.”**

### Live worklist (seeded 60-patient cohort, 4 h = 240 min)

- 37 of 60 patients have an eligible action; **23 are below the line** with no
  modifiable driver (they are not "safe" — the catalog just can't act on them).
- CareTrace selects **12 patients, exactly 240 minutes**, in ~15 ms.
- Same-day comparison vs risk-only is a tie on this one cohort (1 reached each) —
  the 200-day replay above is the real comparison.
- Seed: 11 plans (4 pre-approved, 7 pending), 8 tasks, 23 audit rows.

### Lookalikes (train split, NearestNeighbors k=50)

For the top-risk demo patient: **“34% of 50 similar patients were readmitted
within 30 days vs 9% overall in the training data”** — labelled
**“history, not cause.”**

---

## Two-minute demo script

1. **Worklist** (`/`) — drag *Coordinator hours today* from 4 → 1. The list
   re-ranks live (~15 ms). Point at the **Δ column**: ▲ rows are patients whose
   modifiable drivers make the call worthwhile beyond raw risk; ▼ rows are
   sicker patients with little an intervention can change.
   The **“Why not just call the sickest?”** card shows both policies side by
   side — with the assumption tag on every “avoided” number.
2. **Patient page** — click a row. Show: calibrated risk vs cutoff, SHAP bars
   split **Fixed vs Modifiable** (only teal bars can ever become an action), the
   3 code-generated explanation lines (“Driver: …, because … Suggested action:
   …”), the 30-day timing strip (visual only, shaded early window), matched
   interventions with effect ranges + assumption tags, lookalikes
   (“history, not cause”), and the audit log.
3. **Roles** — as `coordinator`, try Approve → **403**. Switch to `clinician`,
   Approve → plan becomes Approved, follow-up tasks are created with due dates
   from the intervention window, and an audit row appears. Every decision is
   logged; coordinators can only update task status.
4. **Discharge tab** — instructions render from the fixed template (no LLM key
   set) with a **✓ verified** badge: code filled `{DRUG_1}`, `{FOLLOWUP_DATE}`,
   `{INTERVENTION}` from the record. Explain the contract: the LLM may only
   emit placeholders, it never writes a drug name, date, dose or number —
   invalid output is discarded and the template is used. Reminders are marked
   `[SIMULATED - NOT SENT]`.
5. **Ops** — model card (AUC 0.651, calibration points, limits), department and
   diagnosis-group readmission rates from the full dataset, then the replay
   charts with the **red warning banner**, the beat-the-AI chart, and
   bed-days freed **0.7** (0.17 expected avoided × 4.27-day average stay —
   assumption, not a prediction).

---

## Architecture

```
data/diabetic_data.csv  (UCI Diabetes 130-US Hospitals, 1999–2008)
        │
        ▼
backend/ml/features.py     clean, filter, first encounter, patient-level split
backend/ml/concepts.py     101 features → 8 clinical concepts (SHAP grouping)
backend/ml/train.py        XGBoost + isotonic calibrator + TreeExplainer SHAP
backend/ml/lookalike.py    NearestNeighbors(k=50) on scaled train-split features
        │  artifacts/: model.joblib, calibrator.joblib, metrics.json,
        │              shap_test.npz, test_predictions.csv, replay.json
        ▼
backend/decision/catalog.py   6 interventions — synthetic, source="assumption"
backend/decision/optimizer.py eligibility → priority → 0/1 knapsack (pure dicts)
backend/decision/replay.py    200-day backtest: chronological / raw_risk /
                              caretrace / human, 2 metrics, loud warning
        ▼
backend/app/main.py        FastAPI: /worklist /patient/{id} /plan/{id}/decision
                           /tasks /audit /ops /discharge/{id} /meta
backend/app/models.py      patients, predictions, interventions, plans, tasks,
                           reviews, audit_log (SQLite via SQLAlchemy)
backend/language/slots.py  3 explanation lines built from the record (no LLM)
backend/language/templates.py  LLM discharge text (slots only) + fallback
        ▼
frontend/                  React (Vite) + Tailwind + Recharts
                           Worklist · Patient · Discharge · Ops
```

**Decision rules** (identical code in the API and the replay):

- **Eligible** = the intervention's target concept is in the *modifiable* set
  **and** has positive SHAP for this patient. Fixed drivers (age, race, prior
  use, stay severity, admission context) never create eligibility.
- **Priority** = `calibrated_risk × mid_effect × shap_share ÷ minutes`.
- **Selection** = 0/1 knapsack over coordinator minutes, at most one main
  action per patient.

**Roles:** approve/edit/reject require `X-Role: clinician` (403 otherwise,
tested). Task status can be changed by any role. Every state change writes an
`audit_log` row with old/new value, role and actor.

**LLM contract:** if `ANTHROPIC_API_KEY` is set, the model (LangChain →
Anthropic) may only emit `{DRUG_1}`, `{FOLLOWUP_DATE}`, `{INTERVENTION}`
placeholders; code fills them from the record. Output containing a number,
a drug name, an invented slot, or a missing slot is discarded → fixed template.
`verified` is true only when code confirms every slot was filled. **No key is
required — every LLM path has a no-LLM fallback.**

---

## Honesty & safety (also in the app footer)

- Intervention effect sizes and timing windows are **assumptions in a synthetic
  table**, labelled **“assumption, not a prediction”** on every UI surface.
- The LLM only phrases text from slots. It never scores, ranks, or recommends.
- Every high-risk flag requires clinician review; every decision is audited.
- SHAP explains the model on this record — it is not a cause. Lookalike
  outcomes are **history, not cause**.
- Decision support only. Not a diagnostic tool. The dataset is 1999–2008,
  diabetes drugs only, 130 US hospitals.
- Disposition codes 11/13/14/19/20/21 (expired/hospice-style) are excluded
  from the modelling cohort. Note: in this dataset codes 13/14 still show small
  readmission rates (4.8%/6.5%) — the exclusion set follows the project spec
  and is documented, not tuned.
- **The replay warning is real:** CareTrace does not beat raw risk on metric 2
  here. The app shows that banner rather than hiding it.

## Tests

```bash
make test     # 16 passed
```

Covers: patient-level split has no overlap · `readmitted` never appears in
features · expired discharges excluded · knapsack respects the budget and is
optimal vs brute force · coordinator gets 403 on approve · clinician approve
creates tasks · every decision is audited · missing role defaults to
coordinator · no-LLM fallback renders verified text · LLM output with a
number/drug/invented slot is rejected · unfilled slot reports missing ·
eligibility requires a positive modifiable concept · priority formula.

## Environment

- Python 3.12 (works on 3.11; the environment here is 3.12.10)
- `CARETRACE_DB=path/to.db` — point at another database (tests use a temp file)
- `CARETRACE_NO_WARM=1` — skip the lookalike warm-up thread (tests)
- `ANTHROPIC_API_KEY` (optional) — enables the LLM discharge-text path
