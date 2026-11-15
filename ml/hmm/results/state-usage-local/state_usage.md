# Hidden-state usage by call type

Smoothed (forward-backward) posteriors from the shipped model, averaged per call, then over calls.

## Time spent in the scam half

| group | calls | smoothed | filtered (production) |
|---|---|---|---|
| normal (BothBosu) | 1600 | 6.7% | 13.5% |
| scam: refund | 400 | 97.9% | 93.2% |
| scam: reward | 400 | 98.5% | 93.0% |
| scam: ssn | 400 | 98.1% | 94.3% |
| scam: support | 400 | 98.1% | 95.3% |
| YouTube scams | 20 | 49.1% | 43.1% |
| our scripts: scam | 3 | 76.5% | 62.7% |
| our scripts: normal | 7 | 0.5% | 12.8% |

## Share of scam-half time per scam state

Each column sums to 100%. Bold = at least 1.5× that state's average share across scam types.

| state | top emissions | mean position in scam calls | normal (BothBosu) | scam: refund | scam: reward | scam: ssn | scam: support | YouTube scams | our scripts: scam | our scripts: normal |
|---|---|---|---|---|---|---|---|---|---|---|
| s16 | C:PRIZE 0.97 / R:COMPLY 0.01 | 0.54 | 0.2% | **15.2%** | **13.1%** | 0.1% | 0.1% | 0.2% | 0.1% | 0.0% |
| s17 | C:PRIZE 0.98 / C:THREAT 0.00 | 0.20 | 0.9% | **6.2%** | **5.3%** | 0.0% | 0.0% | 1.5% | 0.4% | 0.3% |
| s18 | C:PAY 0.14 / C:INFO 0.14 | 0.69 | 0.0% | 0.8% | 0.6% | **11.8%** | 2.9% | 0.0% | 11.2% | 0.0% |
| s19 | C:INFO 0.49 / C:URGENCY 0.19 | 0.43 | 1.8% | 0.4% | 0.3% | **16.8%** | **11.5%** | 4.3% | 19.3% | 0.1% |
| s20 | C:INFO 0.24 / R:NONE 0.22 | 0.58 | 0.2% | **21.9%** | **19.1%** | 0.2% | 0.1% | 0.1% | 0.2% | 0.0% |
| s21 | C:THREAT 0.27 / C:PAY 0.17 | 0.55 | 0.4% | 0.2% | 0.1% | **10.0%** | **14.1%** | 1.1% | 14.2% | 0.0% |
| s22 | R:NONE 0.65 / R:RESIST 0.20 | 0.52 | 1.8% | 0.4% | 0.3% | **14.1%** | **15.3%** | 3.1% | 15.6% | 0.1% |
| s23 | C:PRIZE 0.36 / C:INFO 0.25 | 0.53 | 3.6% | **11.0%** | **15.5%** | 1.8% | 0.3% | 6.5% | 4.8% | 0.0% |
| s24 | C:NONE 0.80 / C:IMPERSONATE 0.07 | 0.58 | 36.4% | 8.2% | 9.8% | 11.8% | 13.4% | 31.2% | 5.7% | 74.5% |
| s25 | R:NONE 0.59 / C:IMPERSONATE 0.40 | 0.02 | 5.1% | 4.1% | 2.9% | 4.4% | 6.5% | 2.2% | 8.6% | 3.9% |
| s26 | R:NONE 0.74 / R:RESIST 0.18 | 0.57 | 11.9% | 13.9% | **16.9%** | 4.5% | 2.6% | 13.6% | 4.8% | 4.3% |
| s27 | R:NONE 0.81 / R:COMPLY 0.09 | 0.54 | 28.5% | 3.5% | 4.1% | 12.0% | **17.8%** | 23.4% | 3.7% | 15.6% |
| s28 | C:PAY 0.92 / C:IMPERSONATE 0.06 | 0.37 | 1.8% | **7.0%** | **9.2%** | 0.5% | 0.2% | 3.9% | 0.5% | 0.1% |
| s29 | C:URGENCY 0.96 / C:IMPERSONATE 0.02 | 0.21 | 1.1% | 2.6% | 0.6% | 0.1% | 0.0% | 1.4% | 1.4% | 0.0% |
| s30 | R:NONE 0.93 / R:RESIST 0.05 | 0.40 | 1.8% | **4.1%** | 2.1% | 0.2% | 0.2% | 2.6% | 0.2% | 0.3% |
| s31 | C:THREAT 0.72 / C:IMPERSONATE 0.19 | 0.32 | 4.7% | 0.4% | 0.1% | **11.7%** | **14.9%** | 4.7% | 9.4% | 0.7% |

## Most distinctive scam states per type

| scam type | states (lift vs. other types, share) |
|---|---|
| refund | s30 R:NONE 0.93 / R:RESIST 0.05 (×2.5, 4%), s16 C:PRIZE 0.97 / R:COMPLY 0.01 (×2.1, 15%), s17 C:PRIZE 0.98 / C:THREAT 0.00 (×2.1, 6%) |
| reward | s23 C:PRIZE 0.36 / C:INFO 0.25 (×2.2, 15%), s28 C:PAY 0.92 / C:IMPERSONATE 0.06 (×2.2, 9%), s17 C:PRIZE 0.98 / C:THREAT 0.00 (×1.8, 5%) |
| ssn | s18 C:PAY 0.14 / C:INFO 0.14 (×2.9, 12%), s19 C:INFO 0.49 / C:URGENCY 0.19 (×2.3, 17%), s22 R:NONE 0.65 / R:RESIST 0.20 (×1.9, 14%) |
| support | s21 C:THREAT 0.27 / C:PAY 0.17 (×2.3, 14%), s31 C:THREAT 0.72 / C:IMPERSONATE 0.19 (×2.2, 15%), s22 R:NONE 0.65 / R:RESIST 0.20 (×2.0, 15%) |

Mean total-variation distance between scam-type profiles: **0.559** (0 = identical state usage, 1 = no overlap).

## Scam states in call order

Mean relative position (0 = first symbol, 1 = last) where each scam state holds the belief, scam calls only.

- 0.02 · s25 R:NONE 0.59 / C:IMPERSONATE 0.40
- 0.20 · s17 C:PRIZE 0.98 / C:THREAT 0.00
- 0.21 · s29 C:URGENCY 0.96 / C:IMPERSONATE 0.02
- 0.32 · s31 C:THREAT 0.72 / C:IMPERSONATE 0.19
- 0.37 · s28 C:PAY 0.92 / C:IMPERSONATE 0.06
- 0.40 · s30 R:NONE 0.93 / R:RESIST 0.05
- 0.43 · s19 C:INFO 0.49 / C:URGENCY 0.19
- 0.52 · s22 R:NONE 0.65 / R:RESIST 0.20
- 0.53 · s23 C:PRIZE 0.36 / C:INFO 0.25
- 0.54 · s27 R:NONE 0.81 / R:COMPLY 0.09
- 0.54 · s16 C:PRIZE 0.97 / R:COMPLY 0.01
- 0.55 · s21 C:THREAT 0.27 / C:PAY 0.17
- 0.57 · s26 R:NONE 0.74 / R:RESIST 0.18
- 0.58 · s20 C:INFO 0.24 / R:NONE 0.22
- 0.58 · s24 C:NONE 0.80 / C:IMPERSONATE 0.07
- 0.69 · s18 C:PAY 0.14 / C:INFO 0.14
