# Makefile for ecosystem: thin wrappers over npm so `make check` works in every fleet repo.
.PHONY: help install lint build check chart-lint image run
help:
	@echo "targets: install lint build check chart-lint image run"
install:
	npm ci
lint:
	npm run lint
build:
	npm run build
check: lint build
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
