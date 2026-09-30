IMAGE ?= elaatifi/mtpit
TAG ?= latest
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: docker-build docker-push

docker-build:
	docker build --tag $(IMAGE):$(TAG) .

docker-push:
	docker buildx build --platform $(PLATFORMS) --tag $(IMAGE):$(TAG) --push .
