#!/bin/bash
# CPU-only training + evaluation of the phrase-extraction HMM scam detector on ASU Sol.
# Submit from ~/scamhmm:  sbatch sol/train.sbatch
#SBATCH --job-name=scam-hmm
#SBATCH --partition=htc
#SBATCH --account=class_cse49478170fall2026
#SBATCH --qos=class
#SBATCH --cpus-per-task=32
#SBATCH --mem=64G
#SBATCH --time=03:00:00
#SBATCH --output=logs/%x-%j.out

set -euo pipefail
cd "$SLURM_SUBMIT_DIR"
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1  # parallelism comes from joblib across restarts
PY=$HOME/envs/scamhmm/bin/python
OUT=results/$SLURM_JOB_ID-${UNIT:-phrase}
echo "node $(hostname)  cpus $SLURM_CPUS_PER_TASK  unit ${UNIT:-phrase}"
$PY run.py --data data --out "$OUT" --unit "${UNIT:-phrase}" --jobs "$SLURM_CPUS_PER_TASK"
