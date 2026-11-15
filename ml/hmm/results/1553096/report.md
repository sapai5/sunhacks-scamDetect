# HMM scam detector results

Thresholds set on validation for ≤5% false alarms.

## BothBosu only

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.5}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| BothBosu test (320 scam / 320 normal) | hmm | 99.7% | 1.6% | 1.000 | 1.000 | 93.4% |
| BothBosu test (320 scam / 320 normal) | keyword-k | 96.6% | 5.9% | 0.980 | 3 | 69.4% |
| BothBosu test (320 scam / 320 normal) | rule | 99.7% | 16.9% | 0.914 | 1.000 | 100.0% |
| BothBosu test (320 scam / 320 normal) | logreg (full call, offline) | 98.4% | 7.5% | 0.990 | 15 | 0.0% |
| ABCD customer service (normal) (0 scam / 500 normal) | hmm | — | 35.2% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | keyword-k | — | 5.6% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | rule | — | 25.4% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | logreg (full call, offline) | — | 1.6% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | hmm | — | 0.0% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | keyword-k | — | 0.0% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | rule | — | 1.4% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | logreg (full call, offline) | — | 0.0% | — | — | — |
| YouTube real scams (20 scam / 0 normal) | hmm | 65.0% | — | — | 7 | 60.0% |
| YouTube real scams (20 scam / 0 normal) | keyword-k | 65.0% | — | — | 16 | 45.5% |
| YouTube real scams (20 scam / 0 normal) | rule | 85.0% | — | — | 8 | 78.6% |
| YouTube real scams (20 scam / 0 normal) | logreg (full call, offline) | 15.0% | — | — | 23 | 0.0% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | hmm | 97.6% | 13.7% | 0.989 | 1.000 | 92.4% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | keyword-k | 94.7% | 3.6% | 0.987 | 3 | 68.6% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | rule | 98.8% | 14.2% | 0.923 | 1.000 | 99.1% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | logreg (full call, offline) | 93.5% | 2.4% | 0.988 | 15 | 0.0% |
| our test scripts (3 scam / 7 normal) | hmm | 100.0% | 42.9% | 0.952 | 4 | 100.0% |
| our test scripts (3 scam / 7 normal) | keyword-k | 100.0% | 0.0% | 1.000 | 3 | 100.0% |
| our test scripts (3 scam / 7 normal) | rule | 100.0% | 0.0% | 1.000 | 3 | 100.0% |
| our test scripts (3 scam / 7 normal) | logreg (full call, offline) | 100.0% | 0.0% | 1.000 | 5 | 0.0% |

## with hard negatives

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.5}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| BothBosu test (320 scam / 320 normal) | hmm | 100.0% | 7.2% | 1.000 | 1.000 | 100.0% |
| BothBosu test (320 scam / 320 normal) | keyword-k | 96.6% | 5.9% | 0.980 | 3 | 69.4% |
| BothBosu test (320 scam / 320 normal) | rule | 99.7% | 16.9% | 0.914 | 1.000 | 100.0% |
| BothBosu test (320 scam / 320 normal) | logreg (full call, offline) | 99.4% | 10.6% | 0.989 | 15 | 0.3% |
| ABCD customer service (normal) (0 scam / 500 normal) | hmm | — | 3.4% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | keyword-k | — | 5.6% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | rule | — | 25.4% | — | — | — |
| ABCD customer service (normal) (0 scam / 500 normal) | logreg (full call, offline) | — | 2.6% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | hmm | — | 0.2% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | keyword-k | — | 0.0% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | rule | — | 1.4% | — | — | — |
| SpokenWOZ real phone calls (normal) (0 scam / 500 normal) | logreg (full call, offline) | — | 0.0% | — | — | — |
| YouTube real scams (20 scam / 0 normal) | hmm | 75.0% | — | — | 2 | 92.3% |
| YouTube real scams (20 scam / 0 normal) | keyword-k | 65.0% | — | — | 16 | 45.5% |
| YouTube real scams (20 scam / 0 normal) | rule | 85.0% | — | — | 8 | 78.6% |
| YouTube real scams (20 scam / 0 normal) | logreg (full call, offline) | 15.0% | — | — | 23 | 0.0% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | hmm | 98.5% | 3.1% | 0.993 | 1.000 | 99.7% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | keyword-k | 94.7% | 3.6% | 0.987 | 3 | 68.6% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | rule | 98.8% | 14.2% | 0.923 | 1.000 | 99.1% |
| ALL scams vs ALL normals (340 scam / 1320 normal) | logreg (full call, offline) | 94.4% | 3.6% | 0.988 | 15 | 0.3% |
| our test scripts (3 scam / 7 normal) | hmm | 100.0% | 0.0% | 1.000 | 4 | 50.0% |
| our test scripts (3 scam / 7 normal) | keyword-k | 100.0% | 0.0% | 1.000 | 3 | 100.0% |
| our test scripts (3 scam / 7 normal) | rule | 100.0% | 0.0% | 1.000 | 3 | 100.0% |
| our test scripts (3 scam / 7 normal) | logreg (full call, offline) | 100.0% | 0.0% | 1.000 | 5 | 0.0% |

## unseen-type: refund

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.05}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| held-out 'refund' vs all normals (80 scam / 1320 normal) | hmm | 100.0% | 3.0% | 1.000 | 1.000 | 97.5% |
| held-out 'refund' vs all normals (80 scam / 1320 normal) | keyword-k | 100.0% | 3.6% | 0.996 | 2 | 88.8% |
| held-out 'refund' vs all normals (80 scam / 1320 normal) | rule | 100.0% | 14.2% | 0.929 | 1.000 | 100.0% |
| held-out 'refund' vs all normals (80 scam / 1320 normal) | logreg (full call, offline) | 100.0% | 2.9% | 0.997 | 14 | 0.0% |

## unseen-type: reward

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.5}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| held-out 'reward' vs all normals (80 scam / 1320 normal) | hmm | 98.8% | 3.4% | 0.996 | 1.000 | 92.4% |
| held-out 'reward' vs all normals (80 scam / 1320 normal) | keyword-k | 98.8% | 3.6% | 0.992 | 3 | 50.6% |
| held-out 'reward' vs all normals (80 scam / 1320 normal) | rule | 100.0% | 14.2% | 0.929 | 1.000 | 100.0% |
| held-out 'reward' vs all normals (80 scam / 1320 normal) | logreg (full call, offline) | 93.8% | 3.3% | 0.993 | 13 | 0.0% |

## unseen-type: ssn

States: normal 16, scam 16; switching {'switch': 0.02, 'back': 0.1, 'p_scam_start': 0.5}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| held-out 'ssn' vs all normals (80 scam / 1320 normal) | hmm | 98.8% | 3.0% | 0.997 | 1.000 | 97.5% |
| held-out 'ssn' vs all normals (80 scam / 1320 normal) | keyword-k | 98.8% | 3.6% | 0.993 | 2 | 45.6% |
| held-out 'ssn' vs all normals (80 scam / 1320 normal) | rule | 100.0% | 14.2% | 0.929 | 1.000 | 100.0% |
| held-out 'ssn' vs all normals (80 scam / 1320 normal) | logreg (full call, offline) | 100.0% | 3.2% | 0.996 | 15 | 0.0% |

## unseen-type: support

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.2}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| held-out 'support' vs all normals (80 scam / 1320 normal) | hmm | 98.8% | 3.2% | 0.999 | 0.000 | 98.5% |
| held-out 'support' vs all normals (80 scam / 1320 normal) | keyword-k | 88.8% | 3.6% | 0.981 | 4 | 97.0% |
| held-out 'support' vs all normals (80 scam / 1320 normal) | rule | 98.8% | 14.2% | 0.923 | 0.000 | 100.0% |
| held-out 'support' vs all normals (80 scam / 1320 normal) | logreg (full call, offline) | 92.5% | 3.6% | 0.991 | 16 | 0.0% |

## cross-source: single → multi

States: normal 16, scam 16; switching {'switch': 0.05, 'back': 0.01, 'p_scam_start': 0.2}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| multi test (160 scam / 160 normal) | hmm | 100.0% | 51.2% | 0.962 | 1.000 | 100.0% |
| multi test (160 scam / 160 normal) | keyword-k | 95.0% | 10.0% | 0.969 | 3 | 68.9% |
| multi test (160 scam / 160 normal) | rule | 99.4% | 21.2% | 0.891 | 1.000 | 100.0% |
| multi test (160 scam / 160 normal) | logreg (full call, offline) | 100.0% | 23.8% | 0.998 | 12 | 0.0% |

## cross-source: multi → single

States: normal 16, scam 16; switching {'switch': 0.005, 'back': 0.01, 'p_scam_start': 0.5}

| test set | method | recall | false alarms | AUC | median detection turn | at/before first ask |
|---|---|---|---|---|---|---|
| single test (160 scam / 160 normal) | hmm | 96.2% | 16.2% | 0.929 | 0.000 | 99.3% |
| single test (160 scam / 160 normal) | keyword-k | 73.8% | 0.0% | 0.996 | 8 | 18.6% |
| single test (160 scam / 160 normal) | rule | 100.0% | 12.5% | 0.938 | 0.000 | 100.0% |
| single test (160 scam / 160 normal) | logreg (full call, offline) | 86.9% | 3.8% | 0.981 | 16 | 0.0% |
