EXIT_CODE ?= 0
DURATION ?= 0

## Build the integration-test fixture
build:
	@echo built
	@node -e "setTimeout(() => process.exit(Number(process.argv[1])), Number(process.argv[2]))" $(EXIT_CODE) $(DURATION)

helper:
	@echo hidden
