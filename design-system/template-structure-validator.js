/* Kaipability template structure validator, shared logic.
   Pure browser JS, no Node APIs, so the exact same code runs two places:
     1. In the Node CLI (automation/validate-template-structure.js), injected into a
        Playwright-controlled page via page.addScriptTag, then called from
        page.evaluate. The page it runs against there is a real loaded template file.
     2. Live in the Template Designer (portal/design-editor.html), against the
        in-page preview iframe's document, so Generate gets the same check the CLI
        and any future CI gate get, not a separate reimplementation that can drift.

   Checks structure only (are the required regions and slots present, at the right
   count). It does not check visual correctness, that's the separate visual
   regression tooling in automation/. Schema definitions live in
   design-system/template-schema.json and design-system/TEMPLATE_SCHEMA.md, this
   file has no schema values of its own, it only knows how to apply one. */

(function (root) {
  function cardinalityOk(cardinality, count) {
    if (cardinality === 'one') return count === 1;
    if (cardinality === 'one-or-more') return count >= 1;
    if (cardinality === 'zero-or-one') return count === 0 || count === 1;
    throw new Error('Unknown cardinality in schema: ' + cardinality);
  }

  // doc: a Document (the live `document`, or an iframe's `contentDocument`, or
  // Playwright's page-context `document`, anything implementing querySelectorAll).
  function extractStructure(doc) {
    // Nearest ancestor's data-kai-region, or null. Used to check a slot
    // actually sits inside the region its schema entry declares as parent,
    // TEMPLATE_SCHEMA.md promises this is checked, the cardinality-only
    // version of this file did not actually check it, see code review
    // 2026-07-20, a slot in the wrong place had a known name so it passed
    // the "unknown slot" check, and its real parent's own count was
    // unaffected because parent-scoped querySelectorAll never saw it.
    function closestRegionOf(el) {
      var node = el.parentElement;
      while (node) {
        var region = node.getAttribute && node.getAttribute('data-kai-region');
        if (region) return region;
        node = node.parentElement;
      }
      return null;
    }

    function attrList(selector) {
      return Array.prototype.slice.call(doc.querySelectorAll(selector)).map(function (el) {
        return {
          tag: el.tagName.toLowerCase(),
          region: el.getAttribute('data-kai-region'),
          slot: el.getAttribute('data-kai-slot'),
          parentRegion: el.hasAttribute('data-kai-slot') ? closestRegionOf(el) : undefined,
        };
      });
    }

    // TEMPLATE_SCHEMA.md promises a template pointing a slot at a missing
    // asset is invalid, not just present-or-absent. Only catches images that
    // have already finished attempting to load by the time this runs
    // (img.complete === true), synchronously checking anything still
    // in-flight would produce false positives, so a slot whose image src
    // was set moments ago and hasn't resolved yet is not flagged, this is a
    // best-effort check, not a guarantee, callers running immediately after
    // changing a src should allow the image to settle first.
    function findBrokenImages() {
      var broken = [];
      Array.prototype.slice.call(doc.querySelectorAll('[data-kai-slot]')).forEach(function (slotEl) {
        var slotName = slotEl.getAttribute('data-kai-slot');
        var imgs = slotEl.tagName.toLowerCase() === 'img' ? [slotEl] : Array.prototype.slice.call(slotEl.querySelectorAll('img'));
        imgs.forEach(function (img) {
          if (img.complete && img.naturalWidth === 0) {
            broken.push({ slot: slotName, src: img.getAttribute('src') });
          }
        });
      });
      return broken;
    }

    var html = doc.documentElement;
    var pageEls = Array.prototype.slice.call(doc.querySelectorAll('[data-kai-region="page"]'));

    return {
      schemaVersion: html.getAttribute('data-kai-schema-version'),
      regionEls: attrList('[data-kai-region]'),
      slotEls: attrList('[data-kai-slot]'),
      brokenImages: findBrokenImages(),
      pages: pageEls.map(function (pageEl) {
        var headerEls = Array.prototype.slice.call(pageEl.querySelectorAll('[data-kai-region="header"]'));
        var footerEls = Array.prototype.slice.call(pageEl.querySelectorAll('[data-kai-region="footer"]'));
        return {
          headerCount: headerEls.length,
          footerCount: footerEls.length,
          cornerDecorationCount: pageEl.querySelectorAll('[data-kai-slot="corner-decoration"]').length,
          headerLogoCounts: headerEls.map(function (h) {
            return h.querySelectorAll('[data-kai-slot="logo"]').length;
          }),
          footerSlotCounts: footerEls.map(function (f) {
            return {
              pagination: f.querySelectorAll('[data-kai-slot="pagination"]').length,
              legalLine: f.querySelectorAll('[data-kai-slot="legal-line"]').length,
            };
          }),
        };
      }),
    };
  }

  // schema: the parsed contents of design-system/template-schema.json.
  // structure: the return value of extractStructure(). Pure function, no I/O.
  // Returns { errors: [string, ...] }, empty array means it passed.
  function validateStructure(schema, structure) {
    var errors = [];

    if (!structure.schemaVersion) {
      errors.push('missing data-kai-schema-version on <html>');
    } else if (structure.schemaVersion !== schema.schemaVersion) {
      errors.push(
        'declares schema version ' + structure.schemaVersion + ', validator is running schema ' +
        schema.schemaVersion + '. Migrate the template or point the validator at the matching schema version.'
      );
    }

    var knownRegions = Object.keys(schema.regions);
    var knownSlots = Object.keys(schema.slots);

    structure.regionEls.forEach(function (el) {
      if (knownRegions.indexOf(el.region) === -1) {
        errors.push('<' + el.tag + '> has data-kai-region="' + el.region + '", not defined in the schema');
      }
    });
    structure.slotEls.forEach(function (el) {
      if (knownSlots.indexOf(el.slot) === -1) {
        errors.push('<' + el.tag + '> has data-kai-slot="' + el.slot + '", not defined in the schema');
        return;
      }
      var expectedParent = schema.slots[el.slot].parent;
      if (expectedParent !== null && el.parentRegion !== expectedParent) {
        errors.push(
          '<' + el.tag + '> has data-kai-slot="' + el.slot + '", expected inside region "' + expectedParent +
          '", nearest ancestor region is ' + (el.parentRegion ? '"' + el.parentRegion + '"' : 'none')
        );
      }
    });

    (structure.brokenImages || []).forEach(function (img) {
      errors.push('slot "' + img.slot + '" image did not load, src="' + img.src + '"');
    });

    Object.keys(schema.regions).forEach(function (name) {
      var def = schema.regions[name];
      if (def.parent !== null) return;
      var count = structure.regionEls.filter(function (el) { return el.region === name; }).length;
      if (!cardinalityOk(def.cardinality, count)) {
        errors.push('region "' + name + '" cardinality is "' + def.cardinality + '", found ' + count);
      }
    });

    structure.pages.forEach(function (p, i) {
      var label = 'page[' + i + ']';
      if (!cardinalityOk(schema.regions.header.cardinality, p.headerCount)) {
        errors.push(label + ': region "header" cardinality is "' + schema.regions.header.cardinality + '", found ' + p.headerCount);
      }
      if (!cardinalityOk(schema.regions.footer.cardinality, p.footerCount)) {
        errors.push(label + ': region "footer" cardinality is "' + schema.regions.footer.cardinality + '", found ' + p.footerCount);
      }
      if (!cardinalityOk(schema.slots['corner-decoration'].cardinality, p.cornerDecorationCount)) {
        errors.push(
          label + ': slot "corner-decoration" cardinality is "' + schema.slots['corner-decoration'].cardinality +
          '", found ' + p.cornerDecorationCount
        );
      }
      p.headerLogoCounts.forEach(function (count, hIdx) {
        if (!cardinalityOk(schema.slots.logo.cardinality, count)) {
          errors.push(label + ' header[' + hIdx + ']: slot "logo" cardinality is "' + schema.slots.logo.cardinality + '", found ' + count);
        }
      });
      p.footerSlotCounts.forEach(function (counts, fIdx) {
        if (!cardinalityOk(schema.slots.pagination.cardinality, counts.pagination)) {
          errors.push(label + ' footer[' + fIdx + ']: slot "pagination" cardinality is "' + schema.slots.pagination.cardinality + '", found ' + counts.pagination);
        }
        if (!cardinalityOk(schema.slots['legal-line'].cardinality, counts.legalLine)) {
          errors.push(label + ' footer[' + fIdx + ']: slot "legal-line" cardinality is "' + schema.slots['legal-line'].cardinality + '", found ' + counts.legalLine);
        }
      });
    });

    return { errors: errors };
  }

  var api = {
    cardinalityOk: cardinalityOk,
    extractStructure: extractStructure,
    validateStructure: validateStructure,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KaiTemplateValidator = api;
  }
})(typeof window !== 'undefined' ? window : this);
