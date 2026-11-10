# Makefile for ecosystem: thin wrappers over npm so `make check` works in every fleet repo.
.PHONY: help install lint build check check-all chart-lint image run
help:
	@echo "targets: install lint build check check-all chart-lint image run check-fast guide-lint harness-test"
install:
	npm ci
lint:
	npm run lint
build:
	npm run build
check: lint build
# Full local gate: this repo has no deeper test layer than lint + build.
check-all: check
chart-lint:
	helm lint charts/ecosystem
image:
	@if [ -f license.jwt ]; then \
		docker build --secret id=eventcatalog_license,src=license.jwt -t ghcr.io/iqvo/ecosystem:dev .; \
	else \
		echo "note: no license.jwt, building unlicensed (trial notice)"; \
		docker build -t ghcr.io/iqvo/ecosystem:dev .; \
	fi
run: image
	docker run --rm -p 3001:8080 ghcr.io/iqvo/ecosystem:dev

# --- agent harness (harness-template v4) -----------------------------------
.PHONY: check-fast guide-lint harness-test
# Fast local gate used by the agent Stop hook (this repo's own quick checks).
check-fast: lint

guide-lint: ## lint agent guides: skills load, references resolve, context budget
	python3 scripts/harness/guide_lint.py

harness-test: ## unit-test the agent hooks (pre/post/stop)
	python3 scripts/harness/test_hook.py
	python3 scripts/harness/test_red_issue.py
