"""
Background training jobs.

Training takes minutes, so the HTTP request only registers the job and returns
immediately. The Node backend polls for progress and mirrors it into Postgres.
"""

import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone

MACHINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAIN_SCRIPT = os.path.join(MACHINE_ROOT, "src", "pathfinding", "train.py")
MODEL_PATH = os.path.join(MACHINE_ROOT, "models", "path_network.pth")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TrainingJob:
    def __init__(self, epochs: int) -> None:
        self.job_id = str(uuid.uuid4())
        self.epochs = epochs
        self.status = "PENDENTE"
        self.current_epoch: int | None = None
        # Every line the trainer printed, so the client can draw the curve
        # instead of the single last point. A 5000-epoch run reports 100 times,
        # which is small enough to carry in the job and store as JSON.
        self.history: list[dict] = []
        self.train_loss: float | None = None
        self.validation_loss: float | None = None
        self.best_validation_loss: float | None = None
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.error_message: str | None = None
        self.model_path: str | None = None

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "epochs": self.epochs,
            "current_epoch": self.current_epoch,
            "history": self.history,
            "train_loss": self.train_loss,
            "validation_loss": self.validation_loss,
            "best_validation_loss": self.best_validation_loss,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error_message": self.error_message,
            "model_path": self.model_path,
        }


class TrainingManager:
    """One training at a time: two runs would fight over the same .pth file."""

    def __init__(self) -> None:
        # Reentrant: start() holds the lock while calling is_running(), which
        # takes it again. A plain Lock deadlocks the request thread there.
        self._lock = threading.RLock()
        self._jobs: dict[str, TrainingJob] = {}
        self._active: str | None = None

    def get(self, job_id: str) -> TrainingJob | None:
        return self._jobs.get(job_id)

    def is_running(self) -> bool:
        with self._lock:
            if self._active is None:
                return False
            job = self._jobs[self._active]
            return job.status in ("PENDENTE", "EXECUTANDO")

    def start(self, epochs: int, on_finish=None) -> TrainingJob:
        with self._lock:
            if self.is_running():
                raise RuntimeError("A training run is already in progress")

            job = TrainingJob(epochs)
            self._jobs[job.job_id] = job
            self._active = job.job_id

        thread = threading.Thread(
            target=self._run, args=(job, on_finish), daemon=True
        )
        thread.start()

        return job

    def _run(self, job: TrainingJob, on_finish) -> None:
        job.status = "EXECUTANDO"
        job.started_at = _now()

        try:
            # A subprocess keeps the trainer's memory out of the API process and
            # guarantees it is released when the run ends.
            # -u keeps the child's stdout unbuffered. Without it Python block
            # buffers the pipe (8 KB) and the trainer's ~16 progress lines only
            # arrive when the process exits, so polling would report no metrics
            # for the whole run.
            process = subprocess.Popen(
                [sys.executable, "-u", TRAIN_SCRIPT, "--epochs", str(job.epochs)],
                cwd=MACHINE_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

            tail: list[str] = []

            for line in process.stdout:
                tail.append(line.rstrip())
                tail[:] = tail[-40:]
                self._parse_progress(job, line)

            process.wait()

            if process.returncode == 0:
                job.status = "CONCLUIDO"
                job.model_path = MODEL_PATH if os.path.exists(MODEL_PATH) else None
            else:
                job.status = "FALHOU"
                job.error_message = "\n".join(tail[-10:]) or f"exit code {process.returncode}"

        except Exception as error:
            job.status = "FALHOU"
            job.error_message = str(error)

        finally:
            job.finished_at = _now()
            if job.status == "CONCLUIDO" and on_finish is not None:
                try:
                    on_finish()
                except Exception as error:
                    job.error_message = f"trained, but reloading the engine failed: {error}"

    @staticmethod
    def _parse_progress(job: TrainingJob, line: str) -> None:
        """
        Read the loss columns the trainer prints, e.g.

            300/800        0.0624      0.0578      0.0578    0.000300
        """
        parts = line.split()

        if len(parts) < 4 or "/" not in parts[0]:
            return

        try:
            job.train_loss = float(parts[1])
            job.validation_loss = float(parts[2])
            job.best_validation_loss = float(parts[3])
        except ValueError:
            return

        # The first column is "300/800". Reporting it is what lets the client
        # show progress: the losses alone say nothing about how far along a run
        # is, and a run of 800 epochs takes minutes with no other signal.
        try:
            job.current_epoch = int(parts[0].split("/")[0])
        except ValueError:
            return

        learning_rate = None
        if len(parts) >= 5:
            try:
                value = float(parts[4])
                if value > 0 and value < float("inf"):
                    learning_rate = value
            except ValueError:
                pass

        job.history.append(
            {
                "epoch": job.current_epoch,
                "train_loss": job.train_loss,
                "validation_loss": job.validation_loss,
                "best_validation_loss": job.best_validation_loss,
                "learning_rate": learning_rate,
            }
        )


manager = TrainingManager()
