# Hidden-state usage by call type

Smoothed (forward-backward) posteriors from the shipped model, averaged per call, then over calls.

## Time spent in the scam half

| group | calls | smoothed | filtered (production) |
|---|---|---|---|
| normal (BothBosu) | 320 | 7.4% | 13.7% |
| scam: refund | 80 | 98.3% | 93.1% |
| scam: reward | 80 | 98.0% | 92.9% |
| scam: ssn | 80 | 98.1% | 93.6% |
| scam: support | 80 | 98.6% | 95.5% |
| our scripts: scam | 3 | 76.5% | 62.7% |
| our scripts: normal | 7 | 0.5% | 12.8% |

## Share of scam-half time per scam state

Each column sums to 100%. Bold = at least 1.5× that state's average share across scam types.

| state | top emissions | mean position in scam calls | normal (BothBosu) | scam: refund | scam: reward | scam: ssn | scam: support | our scripts: scam | our scripts: normal |
|---|---|---|---|---|---|---|---|---|---|
| s16 | C:PRIZE 0.97 / R:COMPLY 0.01 | 0.55 | 0.1% | **14.8%** | **13.9%** | 0.1% | 0.3% | 0.1% | 0.0% |
| s17 | C:PRIZE 0.98 / C:THREAT 0.00 | 0.20 | 0.7% | **6.6%** | **5.3%** | 0.0% | 0.0% | 0.4% | 0.3% |
| s18 | C:PAY 0.14 / C:INFO 0.14 | 0.68 | 0.0% | 0.7% | 1.1% | **12.5%** | 2.5% | 11.2% | 0.0% |
| s19 | C:INFO 0.49 / C:URGENCY 0.19 | 0.43 | 1.5% | 0.3% | 0.3% | **16.9%** | **11.5%** | 19.3% | 0.1% |
| s20 | C:INFO 0.24 / R:NONE 0.22 | 0.59 | 0.1% | **20.2%** | **20.0%** | 0.2% | 0.4% | 0.2% | 0.0% |
| s21 | C:THREAT 0.27 / C:PAY 0.17 | 0.55 | 0.6% | 0.1% | 0.1% | **9.9%** | **14.7%** | 14.2% | 0.0% |
| s22 | R:NONE 0.65 / R:RESIST 0.20 | 0.53 | 1.8% | 0.2% | 0.3% | **14.2%** | **16.5%** | 15.6% | 0.1% |
| s23 | C:PRIZE 0.36 / C:INFO 0.25 | 0.52 | 4.7% | **11.3%** | **14.6%** | 1.9% | 0.4% | 4.8% | 0.0% |
| s24 | C:NONE 0.80 / C:IMPERSONATE 0.07 | 0.58 | 35.1% | 8.3% | 9.5% | 11.3% | 12.7% | 5.7% | 74.5% |
| s25 | R:NONE 0.59 / C:IMPERSONATE 0.40 | 0.02 | 5.1% | 4.0% | 2.8% | 4.1% | 6.5% | 8.6% | 3.9% |
| s26 | R:NONE 0.74 / R:RESIST 0.18 | 0.56 | 11.7% | **14.9%** | **16.4%** | 4.2% | 2.7% | 4.8% | 4.3% |
| s27 | R:NONE 0.81 / R:COMPLY 0.09 | 0.54 | 27.8% | 3.2% | 4.0% | 12.0% | **16.6%** | 3.7% | 15.6% |
| s28 | C:PAY 0.92 / C:IMPERSONATE 0.06 | 0.37 | 2.6% | **7.8%** | **8.9%** | 0.4% | 0.4% | 0.5% | 0.1% |
| s29 | C:URGENCY 0.96 / C:IMPERSONATE 0.02 | 0.19 | 1.0% | 2.7% | 0.5% | 0.1% | 0.1% | 1.4% | 0.0% |
| s30 | R:NONE 0.93 / R:RESIST 0.05 | 0.39 | 1.8% | **4.5%** | 2.1% | 0.2% | 0.2% | 0.2% | 0.3% |
| s31 | C:THREAT 0.72 / C:IMPERSONATE 0.19 | 0.32 | 5.5% | 0.2% | 0.1% | **12.0%** | **14.5%** | 9.4% | 0.7% |

## Most distinctive scam states per type

| scam type | states (lift vs. other types, share) |
|---|---|
| refund | s30 R:NONE 0.93 / R:RESIST 0.05 (×2.6, 5%), s17 C:PRIZE 0.98 / C:THREAT 0.00 (×2.2, 7%), s16 C:PRIZE 0.97 / R:COMPLY 0.01 (×2.0, 15%) |
| reward | s23 C:PRIZE 0.36 / C:INFO 0.25 (×2.1, 15%), s28 C:PAY 0.92 / C:IMPERSONATE 0.06 (×2.0, 9%), s20 C:INFO 0.24 / R:NONE 0.22 (×2.0, 20%) |
| ssn | s18 C:PAY 0.14 / C:INFO 0.14 (×3.0, 12%), s19 C:INFO 0.49 / C:URGENCY 0.19 (×2.3, 17%), s22 R:NONE 0.65 / R:RESIST 0.20 (×1.8, 14%) |
| support | s21 C:THREAT 0.27 / C:PAY 0.17 (×2.4, 15%), s31 C:THREAT 0.72 / C:IMPERSONATE 0.19 (×2.2, 15%), s22 R:NONE 0.65 / R:RESIST 0.20 (×2.1, 17%) |

Mean total-variation distance between scam-type profiles: **0.555** (0 = identical state usage, 1 = no overlap).

## Scam states in call order

Mean relative position (0 = first symbol, 1 = last) where each scam state holds the belief, scam calls only.

- 0.02 · s25 R:NONE 0.59 / C:IMPERSONATE 0.40
- 0.19 · s29 C:URGENCY 0.96 / C:IMPERSONATE 0.02
- 0.20 · s17 C:PRIZE 0.98 / C:THREAT 0.00
- 0.32 · s31 C:THREAT 0.72 / C:IMPERSONATE 0.19
- 0.37 · s28 C:PAY 0.92 / C:IMPERSONATE 0.06
- 0.39 · s30 R:NONE 0.93 / R:RESIST 0.05
- 0.43 · s19 C:INFO 0.49 / C:URGENCY 0.19
- 0.52 · s23 C:PRIZE 0.36 / C:INFO 0.25
- 0.53 · s22 R:NONE 0.65 / R:RESIST 0.20
- 0.54 · s27 R:NONE 0.81 / R:COMPLY 0.09
- 0.55 · s16 C:PRIZE 0.97 / R:COMPLY 0.01
- 0.55 · s21 C:THREAT 0.27 / C:PAY 0.17
- 0.56 · s26 R:NONE 0.74 / R:RESIST 0.18
- 0.58 · s24 C:NONE 0.80 / C:IMPERSONATE 0.07
- 0.59 · s20 C:INFO 0.24 / R:NONE 0.22
- 0.68 · s18 C:PAY 0.14 / C:INFO 0.14
