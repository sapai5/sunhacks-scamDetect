#!/bin/bash
# Hidden-state usage per scam type for the shipped switching HMM, on ASU Sol (CPU, a few minutes).
# Submit from ~/scamhmm:  sbatch sol/state_usage.sbatch
# Optional: MODEL=results/<job>/model.json sbatch sol/state_usage.sbatch
#SBATCH --job-name=scam-hmm-states
#SBATCH --partition=htc
#SBATCH --account=class_cse49478170fall2026
#SBATCH --qos=class
#SBATCH --cpus-per-task=2
#SBATCH --mem=8G
#SBATCH --time=00:20:00
#SBATCH --output=logs/%x-%j.out

set -euo pipefail
cd "$SLURM_SUBMIT_DIR"
PY=$HOME/envs/scamhmm/bin/python
MODEL=${MODEL:-results/1553096/model.json}
OUT=results/state-usage-$SLURM_JOB_ID
$PY state_usage.py --data data --model "$MODEL" --youtube --out "$OUT"
