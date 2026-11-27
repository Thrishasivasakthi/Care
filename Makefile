# CareTrace build/run entry points. Each target is also runnable directly
# with python/npm if `make` is unavailable (see README).
PY ?= python

.PHONY: setup train seed run ui test

setup:
	$(PY) -m pip install -r requirements.txt

train:
	$(PY) -m backend.ml.train

seed:
	$(PY) -m backend.seed

run:
	$(PY) scripts/run.py

ui:
	cd frontend && npm run dev

test:
	$(PY) -m pytest -q
