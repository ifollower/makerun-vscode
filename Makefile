# SPDX-License-Identifier: Apache-2.0

# Load Dotenv Files

DOTENV_FILES := $(filter-out %.enc,$(wildcard .env .env.*))
ifneq ($(strip $(DOTENV_FILES)),)
	include $(DOTENV_FILES)
	export
endif

# Define Variables

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.ONESHELL:

HELM_RELEASE_NAME ?= mychart
HELM_CHART_DIR ?= charts
HELM_VALUES_FILE ?= values.yaml
K8S_IMAGE_TAG ?= latest
K8S_NAMESPACE ?= default
K8S_KUBECONFIG ?= config/kubeconfig.yaml
K8S_STACK_DIR ?= manifests/overlays
KIND_CLUSTER_NAME ?= template-k8s
KIND_CONFIG ?= config/kind-cluster.yaml

# ─── General ─────────────────────────────────────────────────────────────────────────────────────

default: help

# NOTE Targets MUST have a leading comment line starting with `##` to be included in the list. See the targets below for examples.
#
## Display help message with a list of available tasks and their descriptions
help:
	@awk 'BEGIN {printf "Tasks\n\tA collection of tasks used in the current project.\n\n"}'
	@awk 'BEGIN {printf "Usage\n\tmake $(shell tput -Txterm setaf 6)<task>$(shell tput -Txterm sgr0)\n\n"}' $(MAKEFILE_LIST)
	@awk '/^##/{c=substr($$0,3);next}c&&/^[[:alpha:]][[:alnum:]_-]+:/{print "$(shell tput -Txterm setaf 6)\t" substr($$1,1,index($$1,":")) "$(shell tput -Txterm sgr0)",c}1{c=0}' $(MAKEFILE_LIST) | column -s: -t
.PHONY: help

# ─── Setup & Teardown ────────────────────────────────────────────────────────────────────────────

bootstrap:
	@if ! command -v node >/dev/null 2>&1 || [ "$$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then \
		curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; \
		sudo apt-get install -y nodejs; \
	fi
.PHONY: bootstrap

## Install and configure all dependencies essential for development
setup:
.PHONY: setup

## Remove development artifacts and restore the host to its pre-setup state
teardown:
	@if command -v node >/dev/null 2>&1 && [ "$$(node -p 'process.versions.node.split(".")[0]')" = "22" ]; then \
		sudo apt-get remove -y nodejs; \
		sudo apt-get autoremove -y; \
	fi
.PHONY: teardown

# ─── Git Hooks Manager ───────────────────────────────────────────────────────────────────────────

## Initialize Lefthook Git hooks in the local repository
githooks-lefthook-initialize:
	lefthook install --force
.PHONY: githooks-lefthook-initialize

## Deinitialize Lefthook Git hooks from the local repository
githooks-lefthook-deinitialize:
	lefthook uninstall
.PHONY: githooks-lefthook-deinitialize

# ─── Skills Manager ──────────────────────────────────────────────────────────────────────────────

## Provision new Agent Skills into the project environment
skills-agent-add:
	DISABLE_TELEMETRY=1 skills add git@gitlab.samscm.net:development-environment/templates/skills.git
.PHONY: skills-agent-add

## Synchronize and update existing Agent Skills in the project environment
skills-agent-update:
	DISABLE_TELEMETRY=1 skills update git@gitlab.samscm.net:development-environment/templates/skills.git
.PHONY: skills-agent-update

# ─── Dependency Manager ──────────────────────────────────────────────────────────────────────────

DEPENDENCY_RENOVATE_IMAGE ?= docker.io/renovate/renovate:44.132.5@sha256:2c801b47ce82c349453e554188abe4fa0b51bde333cfea54e67ad8a88d525087
DEPENDENCY_RENOVATE_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace -e LOG_LEVEL=debug -e RENOVATE_REPOSITORIES -e RENOVATE_TOKEN=$(RENOVATE_TOKEN) "$(DEPENDENCY_RENOVATE_IMAGE)"

## Update project dependencies locally using Renovate and generate a report
dependency-renovate-update:
	@mkdir -p logs/dependency

	$(DEPENDENCY_RENOVATE_ALIAS) renovate --platform=local --repository-cache=reset > logs/dependency/renovate.log 2>&1
.PHONY: dependency-renovate-update

# ─── Secrets Manager ─────────────────────────────────────────────────────────────────────────────

SECRETS_SOPS_IMAGE ?= ghcr.io/getsops/sops:v3.13.3@sha256:857f5a151ac0b2bfc55c1e4e5581d66fb8e268e4d106b38e74191f3bac9d58ea
SECRETS_SOPS_ALIAS ?= docker run --rm -v "${PWD}:/workspace" -v "$${HOME}/.gnupg:/root/.gnupg" -w /workspace "$(SECRETS_SOPS_IMAGE)"
SECRETS_SOPS_UID ?= sops-vscode-make

# Usage: make secrets-gpg-generate SECRETS_SOPS_UID=<uid>
#
## Generate a new GPG key pair for SOPS with the specified UID
secrets-gpg-generate:
	@gpg --batch --quiet --passphrase '' --quick-generate-key "$(SECRETS_SOPS_UID)" ed25519 cert,sign 0
	@NEW_FPR="$$(gpg --list-keys --with-colons "$(SECRETS_SOPS_UID)" | awk -F: '/^fpr:/ {print $$10; exit}')"
	@gpg --batch --quiet --passphrase '' --quick-add-key "$${NEW_FPR}" cv25519 encrypt 0
.PHONY: secrets-gpg-generate

# Usage: make secrets-gpg-export SECRETS_SOPS_UID=<uid>
#
## Export the GPG key pair for SOPS with the specified UID to ASCII files
secrets-gpg-export:
	@if [ -z "$(SECRETS_SOPS_UID)" ]; then \
		echo "usage: make secrets-gpg-export SECRETS_SOPS_UID=<uid>" >&2; \
		exit 1; \
	fi

	@gpg --armor --export "$(SECRETS_SOPS_UID)" > "$(SECRETS_SOPS_UID)-public.asc"
	@gpg --armor --export-secret-keys "$(SECRETS_SOPS_UID)" > "$(SECRETS_SOPS_UID)-private.asc"
.PHONY: secrets-gpg-export

# Usage: make secrets-gpg-import [SECRETS_SOPS_UID=<uid>] <key-files>
#
## Import GPG keys from specified files and if provided set ultimate trust for the SOPS UID
secrets-gpg-import:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make secrets-gpg-import <files>" >&2; \
		exit 1; \
	fi

	# Import keys from specified files
	@for file in $(filter-out $@,$(MAKECMDGOALS)); do \
		if [ -f "$$file" ]; then \
			gpg --import "$$file"; \
		fi; \
	done

	# Set ultimate trust for the SECRETS_SOPS_UID
	@if [ "$(origin SECRETS_SOPS_UID)" = "command line" ] && [ -n "$(SECRETS_SOPS_UID)" ]; then \
		FPR="$$( { gpg --list-keys --with-colons "$(SECRETS_SOPS_UID)" 2>/dev/null || true; } | awk -F: '/^fpr:/ {print $$10; exit}')"; \
		if [ -n "$${FPR}" ]; then \
			echo "$${FPR}:6:" | gpg --import-ownertrust; \
		fi; \
	fi
.PHONY: secrets-gpg-import

# Usage: make secrets-gpg-remove SECRETS_SOPS_UID=<uid>
#
## Remove GPG keys for SOPS with the specified UID (interactive)
secrets-gpg-remove:
	@if ! gpg --list-keys "$(SECRETS_SOPS_UID)" >/dev/null 2>&1; then
		echo "warning: no key found for '$(SECRETS_SOPS_UID)'" >&2
		exit 0
	fi

	# Delete private key first, then public key
	@gpg --yes --delete-secret-keys "$(SECRETS_SOPS_UID)"
	@gpg --yes --delete-keys "$(SECRETS_SOPS_UID)"
.PHONY: secrets-gpg-remove

# Usage: make secrets-gpg-show [SECRETS_SOPS_UID=<uid>]
#
## Show GPG public key information for SOPS UID or list all keys if UID is not set
secrets-gpg-show:
	@if [ "$(origin SECRETS_SOPS_UID)" != "command line" ]; then \
		gpg --list-keys --keyid-format long; \
		exit 0; \
	fi

	@FPR="$$( { gpg --list-keys --with-colons "$(SECRETS_SOPS_UID)" 2>/dev/null || true; } | awk -F: '/^fpr:/ {print $$10; exit}')"; \
	if [ -z "$${FPR}" ]; then \
		echo "error: no fingerprint found for UID '$(SECRETS_SOPS_UID)'" >&2; \
		exit 1; \
	fi; \
	echo -e "UID: $(SECRETS_SOPS_UID)\nFingerprint: $${FPR}"
.PHONY: secrets-gpg-show

# Usage: make secrets-sops-encrypt <files>
#
## Encrypt specified files using SOPS with GPG keys, writing output to <file>.enc
secrets-sops-encrypt:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make secrets-sops-encrypt <files>" >&2; \
		exit 1; \
	fi

	@for file in $(filter-out $@,$(MAKECMDGOALS)); do \
		if [ -f "$$file" ]; then \
			$(SECRETS_SOPS_ALIAS) encrypt --output "$$file.enc" "$$file"; \
		else \
			echo "file not found: $$file" >&2; \
		fi; \
	done
.PHONY: secrets-sops-encrypt

# Usage: make secrets-sops-decrypt <files>
#
## Decrypt specified SOPS-encrypted files (expects <file>.enc), writing output to <file>
secrets-sops-decrypt:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make secrets-sops-decrypt <files>" >&2; \
		exit 1; \
	fi

	@for file in $(filter-out $@,$(MAKECMDGOALS)); do \
		case "$$file" in \
			*.enc) \
				$(SECRETS_SOPS_ALIAS) decrypt --filename-override "$${file%.enc}" --output "$${file%.enc}" "$$file"; \
				;; \
			*) \
				$(SECRETS_SOPS_ALIAS) decrypt --in-place "$$file"; \
				;; \
		esac; \
	done
.PHONY: secrets-sops-decrypt

# Usage: make secrets-sops-view <file>
#
## View decrypted contents of a SOPS-encrypted file using GPG keys
secrets-sops-view:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make secrets-sops-view <file>" >&2; \
		exit 1; \
	fi

	$(SECRETS_SOPS_ALIAS) decrypt "$(filter-out $@,$(MAKECMDGOALS))"
.PHONY: secrets-sops-view

# ─── Policy Manager ──────────────────────────────────────────────────────────────────────────────

POLICY_CONFTEST_IMAGE ?= docker.io/openpolicyagent/conftest:v0.71.0@sha256:3ec6dad358db08acecda56b7a3184037cd810394a65046fafa4f33c7750141b1
POLICY_CONFTEST_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace "$(POLICY_CONFTEST_IMAGE)"

# Usage: make policy-conftest-test <filepath>
#
## Run Conftest container in REPL (Read-Eval-Print-Loop) to evaluate policies against input data and generate a report
policy-conftest-test:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make policy-conftest-test <filepath>"; \
		exit 1; \
	fi

	@mkdir -p logs/policy

	$(POLICY_CONFTEST_ALIAS) test "$(filter-out $@,$(MAKECMDGOALS))" > logs/policy/conftest-report.json 2>&1
.PHONY: policy-conftest-test

POLICY_REGAL_IMAGE ?= ghcr.io/open-policy-agent/regal:0.43.0@sha256:29460f0ec1340d37f6c0c74bcbd88dd232fd8382c7a2337f0684415bd4c46da1
POLICY_REGAL_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace "$(POLICY_REGAL_IMAGE)"

# Usage: make policy-regal-lint <filepath>
#
## Lint Rego policies using Regal and generate a report
policy-regal-lint:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make policy-regal-lint <filepath>"; \
		exit 1; \
	fi

	@mkdir -p logs/policy

	$(POLICY_REGAL_ALIAS) lint "$(filter-out $@,$(MAKECMDGOALS))" --format json > logs/policy/regal.json 2>&1
.PHONY: policy-regal-lint

# ─── SAST Manager ────────────────────────────────────────────────────────────────────────────────

SAST_SEMGREP_IMAGE ?= semgrep/semgrep:1.179.0@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b
SAST_SEMGREP_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_SEMGREP_IMAGE)"
SAST_SEMGREP_FILES ?= .
SAST_SEMGREP_FILTER = $(if $(strip $(SAST_SEMGREP_FILES)),$(SAST_SEMGREP_FILES),.)

## Scan source code for security issues using Semgrep and generate a report
sast-semgrep-scan:
	@mkdir -p logs/sast

	$(SAST_SEMGREP_ALIAS) semgrep scan --config auto --error --json --output logs/sast/semgrep.json $(SAST_SEMGREP_FILTER) 2> logs/sast/semgrep.log
.PHONY: sast-semgrep-scan

SAST_TRIVY_IMAGE ?= aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa
SAST_TRIVY_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_TRIVY_IMAGE)"
SAST_TRIVY_FILES ?= .

## Scan Infrastructure-as-Code (IaC) files for misconfigurations using Trivy and generate a report
sast-trivy-misconfig:
	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) config --output logs/sast/trivy-misconfig.json $(SAST_TRIVY_FILES) 2>&1
.PHONY: sast-trivy-misconfig

## Scan local filesystem for vulnerabilities and misconfigurations using Trivy
sast-trivy-fs:
	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) filesystem --output logs/sast/trivy-filesystem.json /workspace 2>&1
.PHONY: sast-trivy-fs

# Usage: make sast-trivy-image <image_name>
#
## Scan a container image for vulnerabilities using Trivy
sast-trivy-image:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-image <image_name>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${PWD}:/workspace" -w /workspace "$(SAST_TRIVY_IMAGE)" image --output logs/sast/trivy-image.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-image

# Usage: make sast-trivy-image-license <image_name>
#
## Scan a container image for license compliance using Trivy
sast-trivy-image-license:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-image-license <image_name>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) image --scanners license --format table --output logs/sast/trivy-image-license.txt "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-image-license

# Usage: make sast-trivy-repository <repo_url>
#
## Scan a remote repository for vulnerabilities using Trivy
sast-trivy-repository:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-repository <repo_url>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) repository --output logs/sast/trivy-repository.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-repository

# Usage: make sast-trivy-rootfs <path>
#
## Scan a rootfs e.g. `/` for vulnerabilities using Trivy
sast-trivy-rootfs:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-rootfs <path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) rootfs --output logs/sast/trivy-rootfs.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-rootfs

# Usage: make sast-trivy-sbom-scan <sbom_path>
#
## Scan SBOM for vulnerabilities using Trivy
sast-trivy-sbom-scan:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-sbom-scan <sbom_path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) sbom --output logs/sast/trivy-sbom.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-sbom-scan

# Usage: make sast-trivy-sbom-cyclonedx-image <image_name>
#
## Generate SBOM in CycloneDX format for a container image using Trivy
sast-trivy-sbom-cyclonedx-image:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-sbom-cyclonedx-image <image_name>"; \
		exit 1; \
	fi

	@mkdir -p logs/sbom

	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${PWD}:/workspace" -w /workspace "$(SAST_TRIVY_IMAGE)" image --format cyclonedx --output logs/sbom/sbom-image.cdx.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-sbom-cyclonedx-image

# Usage: make sast-trivy-sbom-cyclonedx-fs <path>
#
## Generate SBOM in CycloneDX format for a file system using Trivy
sast-trivy-sbom-cyclonedx-fs:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-sbom-cyclonedx-fs <path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sbom

	$(SAST_TRIVY_ALIAS) filesystem --format cyclonedx --output logs/sbom/sbom-fs.cdx.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-sbom-cyclonedx-fs

# Usage: make sast-trivy-sbom-license <sbom_path>
#
## Scan SBOM for license compliance using Trivy
sast-trivy-sbom-license:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-sbom-license <sbom_path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) sbom --scanners license --format table --output logs/sast/trivy-sbom-license.txt "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-sbom-license

# Usage: make sast-trivy-sbom-attestation <intoto_sbom_path>
#
## Scan the verified SBOM attestation using Trivy
sast-trivy-sbom-attestation:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-sbom-attestation <intoto_sbom_path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) sbom "$(filter-out $@,$(MAKECMDGOALS))"
.PHONY: sast-trivy-sbom-attestation

# Usage: make sast-trivy-vm <vm_image_path>
#
## [EXPERIMENTAL] Scan a virtual machine image using Trivy
sast-trivy-vm:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-trivy-vm <vm_image_path>"; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_TRIVY_ALIAS) vm --output logs/sast/trivy-vm.json "$(filter-out $@,$(MAKECMDGOALS))" 2>&1
.PHONY: sast-trivy-vm

# Usage: make sast-trivy-kubernetes [target]
#
## [EXPERIMENTAL] Scan kubernetes cluster using Trivy (default `cluster`)
sast-trivy-kubernetes:
	@echo "Note: This requires KUBECONFIG to be mounted or available to the container. Assuming ~/.kube/config is mounted to /root/.kube/config"

	@mkdir -p logs/sast

	docker run --rm -v "${HOME}/.kube/config:/root/.kube/config" -v "${PWD}:/workspace" -w /workspace "$(SAST_TRIVY_IMAGE)" kubernetes --output logs/sast/trivy-kubernetes.json $(if $(filter-out $@,$(MAKECMDGOALS)),$(filter-out $@,$(MAKECMDGOALS)),cluster) 2>&1
.PHONY: sast-trivy-kubernetes

SAST_IMAGE_GITLEAKS ?= ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f

## Scan git repository history for leaked secrets using Gitleaks and generate a report
sast-gitleaks-detect:
	@mkdir -p logs/sast

	docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_IMAGE_GITLEAKS)" detect --redact --source /workspace --report-format json --report-path logs/sast/gitleaks-detect.json 2>&1
.PHONY: sast-gitleaks-detect

## Scan staged git changes for leaked secrets using Gitleaks and generate a report
sast-gitleaks-staged:
	@mkdir -p logs/sast

	docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_IMAGE_GITLEAKS)" protect --redact --staged --source /workspace --report-format json --report-path logs/sast/gitleaks-protect.json 2>&1
.PHONY: sast-gitleaks-staged

SAST_IMAGE_TRUFFLEHOG ?= trufflesecurity/trufflehog:3.97.9@sha256:52e67fef4d054ecff5c2ce4b4ae376626d1ef54aa0898b53cac19c25e92e14db

## Scan local filesystem for leaked secrets using TruffleHog and generate a report
sast-trufflehog-fs:
	@mkdir -p logs/sast

	docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_IMAGE_TRUFFLEHOG)" filesystem . --no-update --json > logs/sast/trufflehog-filesystem.json 2> logs/sast/trufflehog-filesystem.log
.PHONY: sast-trufflehog-fs

## Scan git repository history for leaked secrets using TruffleHog and generate a report
sast-trufflehog-git:
	@mkdir -p logs/sast

	docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_IMAGE_TRUFFLEHOG)" git file:///workspace --no-update --json > logs/sast/trufflehog-git.json 2> logs/sast/trufflehog-git.log
.PHONY: sast-trufflehog-git

# ─── Supply Chain Security ───────────────────────────────────────────────────────────────────────

SAST_COSIGN_IMAGE ?= cgr.dev/chainguard/cosign:3.0.0@sha256:b6bc266358e9368be1b3d01fca889b78d5ad5a47832986e14640c34a237ef638
SAST_COSIGN_ALIAS := docker run --rm -v "${PWD}:/workspace" -w /workspace "$(SAST_COSIGN_IMAGE)"

## Generate Cosign key pair
sast-cosign-generate-key-pair:
	$(SAST_COSIGN_ALIAS) generate-key-pair
.PHONY: sast-cosign-generate-key-pair

# Usage: make sast-cosign-attest <image_name>
#
## Attest an image with the generated SBOM using Cosign
sast-cosign-attest:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-cosign-attest <image_name>"; \
		exit 1; \
	fi
	@if [ ! -f cosign.key ]; then \
		echo "Error: cosign.key not found. Run 'make sast-cosign-generate-key-pair' first."; \
		exit 1; \
	fi
	@if [ ! -f logs/sbom/sbom.cdx.json ]; then \
		echo "Error: logs/sbom/sbom.cdx.json not found. Run 'make sast-trivy-sbom-cyclonedx <image_name>' first."; \
		exit 1; \
	fi

	$(SAST_COSIGN_ALIAS) attest --key cosign.key --type cyclonedx --predicate logs/sbom/sbom.cdx.json "$(filter-out $@,$(MAKECMDGOALS))"
.PHONY: sast-cosign-attest

# Usage: make sast-cosign-verify <image_name>
#
## Verify SBOM attestation for an image using Cosign
sast-cosign-verify:
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "usage: make sast-cosign-verify <image_name>"; \
		exit 1; \
	fi
	@if [ ! -f cosign.pub ]; then \
		echo "Error: cosign.pub not found. Run 'make sast-cosign-generate-key-pair' first."; \
		exit 1; \
	fi

	@mkdir -p logs/sast

	$(SAST_COSIGN_ALIAS) verify-attestation --key cosign.pub --type cyclonedx "$(filter-out $@,$(MAKECMDGOALS))" > logs/sbom/sbom.cdx.intoto.jsonl 2> logs/sast/cosign-verify.log
.PHONY: sast-cosign-verify

# ─── Container Manager ───────────────────────────────────────────────────────────────────────────

CONTAINER_DOCKER_IMAGE ?= $(notdir $(shell git rev-parse --show-toplevel 2>/dev/null))
CONTAINER_DOCKER_TAG ?= $(or $(shell git tag --sort=-creatordate | head -n 1),latest)
CONTAINER_DOCKER_CONTEXT ?= .
CONTAINER_DOCKER_FILE ?= container/k8s/Dockerfile

# Usage: make container-docker-build [CONTAINER_DOCKER_IMAGE=<name>] [CONTAINER_DOCKER_TAG=<tag>] [CONTAINER_DOCKER_FILE=<file>] [CONTAINER_DOCKER_CONTEXT=<context>]
#
## Build the Docker container image with the specified name, tag, and context
container-docker-build:
	docker build -f "$(CONTAINER_DOCKER_FILE)" -t "$(CONTAINER_DOCKER_IMAGE):$(CONTAINER_DOCKER_TAG)" "$(CONTAINER_DOCKER_CONTEXT)"
.PHONY: container-docker-build

# Usage: make container-docker-run [CONTAINER_DOCKER_IMAGE=<name>] [CONTAINER_DOCKER_TAG=<tag>]
#
## Run the Docker container image with the specified name and tag
container-docker-run:
	docker run --rm "$(CONTAINER_DOCKER_IMAGE):$(CONTAINER_DOCKER_TAG)"
.PHONY: container-docker-run

## Teardown Docker containers and remove all unused images, containers, volumes, and networks
container-docker-teardown:
	# Display Docker disk usage statistics (images, containers, networks, volumes with links and sizes)
	@docker system df -v
	# Remove all unused Docker objects (images, containers, networks)
	@docker system prune -f -a --filter "until=24h"
	# Remove all Docker volumes (unused named `LINKS = 0`, anonymous)
	@docker volume prune -f -a --filter "label!=keep=true"
.PHONY: container-docker-teardown

# ─── VS Code Extension ───────────────────────────────────────────────────────────────────────────

VSCODE_EXTENSION_DIR ?= .
VSCODE_EXTENSION_OUT ?= out
VSCODE_EXTENSION_VSIX ?= $(VSCODE_EXTENSION_OUT)/make-run-tasks-extension.vsix
VSCODE_EXTENSION_ID ?=
VSCODE_EXTENSION_DIR_ABS := $(abspath $(VSCODE_EXTENSION_DIR))
VSCODE_EXTENSION_OUT_ABS := $(abspath $(VSCODE_EXTENSION_OUT))
VSCODE_EXTENSION_VSIX_ABS := $(abspath $(VSCODE_EXTENSION_VSIX))

VSCODE_CLI ?= code
NPM ?= npm
VSCE ?= $(NPM) exec -- vsce
VSCE_PUBLISH_ARGS ?=
VSCE_VERSION_BUMP ?= patch

# Usage: make vsce-id-check [VSCODE_EXTENSION_DIR=<dir>] [VSCODE_EXTENSION_ID=<publisher.name>]
#
## Check whether a VS Code Marketplace extension identity has a discoverable record
vsce-id-check: vsce-dependencies
	@test -f "$(VSCODE_EXTENSION_DIR_ABS)/package.json" || { \
		echo "error: package.json not found in $(VSCODE_EXTENSION_DIR_ABS)" >&2; \
		exit 2; \
	}

	@extension_id="$(strip $(VSCODE_EXTENSION_ID))"; \
	if [ -z "$$extension_id" ]; then \
		extension_id="$$(cd "$(VSCODE_EXTENSION_DIR_ABS)" && \
			node -e 'const p = require("./package.json"); const publisher = typeof p.publisher === "string" ? p.publisher.trim() : ""; const name = typeof p.name === "string" ? p.name.trim() : ""; if (!publisher || !name) { console.error("error: package.json must define non-empty publisher and name fields"); process.exit(1); } process.stdout.write(publisher + "." + name);')" || exit 2; \
	fi; \
	tmp_dir="$$(mktemp -d 2>/dev/null || mktemp -d "$${TMPDIR:-/tmp}/vsce-id-check.XXXXXX")"; \
	trap 'rm -rf "$$tmp_dir"' EXIT; \
	stdout_file="$$tmp_dir/stdout"; \
	stderr_file="$$tmp_dir/stderr"; \
	if ! (cd "$(VSCODE_EXTENSION_DIR_ABS)" && \
		$(VSCE) show "$$extension_id" --json >"$$stdout_file" 2>"$$stderr_file"); then \
		echo "error: unable to query the Marketplace for $$extension_id" >&2; \
		cat "$$stderr_file" >&2; \
		exit 2; \
	fi; \
	if grep -Eq '^[[:space:]]*(undefined|null)?[[:space:]]*$$' "$$stdout_file"; then \
		echo "No discoverable Marketplace record for $$extension_id."; \
		echo "Warning: a permanently removed identity may still be reserved." >&2; \
		exit 0; \
	fi; \
	if node -e 'const fs = require("fs"); const value = JSON.parse(fs.readFileSync(0, "utf8")); if (!value || !value.extensionName || !value.publisher || !value.publisher.publisherName) process.exit(1);' <"$$stdout_file" 2>/dev/null; then \
		echo "Unavailable: an extension record exists for $$extension_id" >&2; \
		exit 1; \
	fi; \
	echo "error: unexpected Marketplace response for $$extension_id" >&2; \
	cat "$$stdout_file" >&2; \
	cat "$$stderr_file" >&2; \
	exit 2
.PHONY: vsce-id-check

# Usage: make vsce-dependencies [VSCODE_EXTENSION_DIR=<dir>]
#
## Install the VS Code extension development dependencies
vsce-dependencies:
	@test -f "$(VSCODE_EXTENSION_DIR_ABS)/package.json" || { \
		echo "error: package.json not found in $(VSCODE_EXTENSION_DIR_ABS)" >&2; \
		exit 1; \
	}

	@command -v "$(NPM)" >/dev/null 2>&1 || { \
		echo "error: $(NPM) is not installed or not available in PATH" >&2; \
		exit 1; \
	}

	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && { \
		if [ -f package-lock.json ]; then \
			$(NPM) ci; \
		else \
			echo "warning: package-lock.json not found; using npm install" >&2; \
			$(NPM) install; \
		fi; \
	}
.PHONY: vsce-dependencies

# Usage: make vsce-build [VSCODE_EXTENSION_DIR=<dir>]
#
## Validate, test, and build the VS Code extension
vsce-build: vsce-dependencies
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run check
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run build
.PHONY: vsce-build

# Usage: make vsce-package [VSCODE_EXTENSION_DIR=<dir>] [VSCODE_EXTENSION_OUT=<out>] [VSCODE_EXTENSION_VSIX=<file>]
#
## Build and package the VS Code extension as a VSIX archive
vsce-package: vsce-dependencies
	@mkdir -p "$(dir $(VSCODE_EXTENSION_VSIX_ABS))"

	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && \
		$(VSCE) package --no-dependencies --out "$(VSCODE_EXTENSION_VSIX_ABS)"
.PHONY: vsce-package

# Usage: make vsce-login [VSCODE_EXTENSION_DIR=<dir>]
#
## Log in to Marketplace as ai-follwer and save credentials locally
vsce-login:
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run marketplace:login
.PHONY: vsce-login

# Usage: make vsce-preview [VSCODE_EXTENSION_DIR=<dir>]
#
## Check, build, and package the current version without uploading to Marketplace
vsce-preview:
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run marketplace:preview
.PHONY: vsce-preview

# Usage: make vsce-publish [VSCODE_EXTENSION_DIR=<dir>] [VSCE_PUBLISH_ARGS="--azure-credential"]
#
## Check, build, package, and publish the current version to Marketplace
vsce-publish:
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run marketplace:publish -- $(VSCE_PUBLISH_ARGS)
.PHONY: vsce-publish

# Usage: make vsce-version [VSCE_VERSION_BUMP=patch|minor|major]
#
## Upgrade the package and lockfile version without creating a Git commit or tag
vsce-version:
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) version "$(VSCE_VERSION_BUMP)" --no-git-tag-version
.PHONY: vsce-version

# Usage: make vsce-release [VSCE_VERSION_BUMP=patch|minor|major] [VSCE_PUBLISH_ARGS="--azure-credential"]
#
## Upgrade the version (patch by default), then check, build, package, and publish
vsce-release: vsce-version
	@cd "$(VSCODE_EXTENSION_DIR_ABS)" && $(NPM) run marketplace:publish -- $(VSCE_PUBLISH_ARGS)
.PHONY: vsce-release

# Usage: make vsce-publish-azure [VSCODE_EXTENSION_DIR=<dir>]
#
## Publish the current version using Microsoft Entra ID / Azure credentials
vsce-publish-azure:
	@$(MAKE) vsce-publish VSCE_PUBLISH_ARGS="--azure-credential"
.PHONY: vsce-publish-azure

# Usage: make vsce-install [VSCODE_EXTENSION_DIR=<dir>] [VSCODE_EXTENSION_OUT=<out>] [VSCODE_EXTENSION_VSIX=<file>] [VSCODE_CLI=code]
#
## Package and install the VS Code extension locally
vsce-install: vsce-package
	@command -v "$(VSCODE_CLI)" >/dev/null 2>&1 || { \
		echo "error: $(VSCODE_CLI) is not installed or not available in PATH" >&2; \
		exit 1; \
	}

	@test -f "$(VSCODE_EXTENSION_VSIX_ABS)" || { \
		echo "error: VSIX not found: $(VSCODE_EXTENSION_VSIX_ABS)" >&2; \
		exit 1; \
	}

	@"$(VSCODE_CLI)" --install-extension "$(VSCODE_EXTENSION_VSIX_ABS)" --force
.PHONY: vsce-install

# Usage: make vsce-uninstall [VSCODE_EXTENSION_DIR=<dir>] [VSCODE_EXTENSION_ID=<publisher.name>] [VSCODE_CLI=code]
#
# NOTE VSCODE_EXTENSION_ID is omitted, when the identifier is derived from package.json as "<publisher>.<name>".
#
## Uninstall the VS Code extension
vsce-uninstall:
	@command -v "$(VSCODE_CLI)" >/dev/null 2>&1 || { \
		echo "error: $(VSCODE_CLI) is not installed or not available in PATH" >&2; \
		exit 1; \
	}

	@test -f "$(VSCODE_EXTENSION_DIR_ABS)/package.json" || { \
		echo "error: package.json not found in $(VSCODE_EXTENSION_DIR_ABS)" >&2; \
		exit 1; \
	}

	@extension_id="$(strip $(VSCODE_EXTENSION_ID))"; \
	if [ -z "$$extension_id" ]; then \
		extension_id="$$(cd "$(VSCODE_EXTENSION_DIR_ABS)" && \
			node -p "const p = require('./package.json'); p.publisher + '.' + p.name")"; \
	fi; \
	"$(VSCODE_CLI)" --uninstall-extension "$$extension_id"
.PHONY: vsce-uninstall

# Usage: make vsce-reinstall [configuration...]
#
## Uninstall, rebuild, package, and install the VS Code extension
vsce-reinstall:
	@$(MAKE) vsce-uninstall \
		VSCODE_EXTENSION_DIR="$(VSCODE_EXTENSION_DIR)" \
		VSCODE_EXTENSION_ID="$(VSCODE_EXTENSION_ID)" \
		VSCODE_CLI="$(VSCODE_CLI)" || true

	@$(MAKE) vsce-install \
		VSCODE_EXTENSION_DIR="$(VSCODE_EXTENSION_DIR)" \
		VSCODE_EXTENSION_OUT="$(VSCODE_EXTENSION_OUT)" \
		VSCODE_EXTENSION_VSIX="$(VSCODE_EXTENSION_VSIX)" \
		VSCODE_CLI="$(VSCODE_CLI)"
.PHONY: vsce-reinstall

# Usage: make vsce-clean [VSCODE_EXTENSION_OUT=<out>]
#
## Remove generated VS Code extension artifacts
vsce-clean:
	@rm -rf "$(VSCODE_EXTENSION_OUT_ABS)"
.PHONY: vsce-clean
