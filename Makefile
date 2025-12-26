UUID := p7-borders@prasannavl.com
DIST_DIR := dist
SCHEMAS_DIR := schemas
JS_FILES := $(wildcard *.js)
EXTRA_SOURCES := $(filter-out extension.js prefs.js,$(JS_FILES))
EXTRA_SOURCE_ARGS := $(foreach f,$(EXTRA_SOURCES),--extra-source=$(f))

.PHONY: lint schemas pack install enable disable reload clean

lint:
	biome lint $(JS_FILES)

schemas:
	glib-compile-schemas $(SCHEMAS_DIR)

pack: schemas
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir $(DIST_DIR) $(EXTRA_SOURCE_ARGS)

install: pack
	gnome-extensions install --force $(DIST_DIR)/$(UUID).shell-extension.zip

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: disable enable

clean:
	rm -rf $(DIST_DIR)
	rm -rf $(SCHEMAS_DIR)/*.gschema.compiled
