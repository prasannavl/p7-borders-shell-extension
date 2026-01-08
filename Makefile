UUID := p7-borders@prasannavl.com
DIST_DIR := dist
SCHEMAS_DIR := schemas
JS_FILES := $(wildcard *.js)
EXTRA_SOURCES := $(filter-out extension.js prefs.js,$(JS_FILES)) README.md CHANGELOG.md
EXTRA_SOURCE_ARGS := $(foreach f,$(EXTRA_SOURCES),--extra-source=$(f))

.PHONY: lint schemas version pack install ginstall enable disable reload clean

lint:
	biome lint $(JS_FILES)

fmt:
	biome format --fix $(JS_FILES)

schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

version:
	@current=$$(sed -nE 's/.*"version":[[:space:]]*([0-9]+).*/\1/p' metadata.json); \
	new=$$((current + 1)); \
	tmp=$$(mktemp); \
	sed -E "s/\"version\": [0-9]+/\"version\": $$new/" metadata.json > $$tmp && mv $$tmp metadata.json; \
	echo "version $$new"

pack: schemas
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir $(DIST_DIR) $(EXTRA_SOURCE_ARGS)

install: pack
	dest=$(DESTDIR)/share/gnome-shell/extensions/$(UUID); \
	mkdir -p "$$dest"; \
	unzip -q -o $(DIST_DIR)/$(UUID).shell-extension.zip -d "$$dest"; \
	cp -r schemas "$$dest"/

ginstall: pack
	gnome-extensions install --force $(DIST_DIR)/$(UUID).shell-extension.zip

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: disable enable

clean:
	rm -rf $(DIST_DIR)
	rm -rf $(SCHEMAS_DIR)/*.gschema.compiled
