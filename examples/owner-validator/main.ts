import { Plugin } from "obsidian";
// In another repository, vendor api.ts as src/vendor/okf-api.ts and adjust this import.
import { attachValidator } from "../../api";

/** A companion plugin: policy belongs here, reporting belongs to Enforcer. */
export default class OwnerValidator extends Plugin {
  onload() {
    attachValidator(this.app, this, {
      id: "example-owner/required-owner",
      name: "Owner policy",
      validate(context) {
        if (context.signal.aborted || context.kind !== "concept" || context.frontmatterState !== "valid") return [];
        const owner = context.frontmatter?.owner;
        return typeof owner === "string" && owner.trim() ? [] : [{
          rule: "owner-required",
          severity: "error",
          message: "Set a non-empty owner in frontmatter.",
        }];
      },
    });
  }
}
