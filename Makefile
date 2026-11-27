# CareTrace build/run entry points. Each target is also runnable directly
# with python/npm if `make` is unavailable (see README).
PY ?= python

.PHONY: setup train seed run ui test replay reset

setup:
	$(PY) -m pip install -r requirements.txt
	cd frontend && npm install

train:
	$(PY) -m backend.ml.train

seed:
	$(PY) -m backend.seed

run:
	$(PY) scripts/run.py

ui:
	cd frontend && npm run dev

replay:
	$(PY) -m backend.decision.replay

reset:
	curl -X POST http://127.0.0.1:8000/demo/reset
