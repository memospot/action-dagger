import * as core from "@actions/core";
import { postAction } from "./post-action";
import { runAction } from "./run-action";

/**
 * Main entry point - determines whether to run main or post phase
 */
if (require.main === module) {
    (async () => {
        const isPost = process.env.STATE_isPost === "true";

        // Use console.error for critical startup messages (always visible)
        console.error(
            `[DAGGER-ACTION] Starting. isPost=${isPost}, STATE_isPost=${process.env.STATE_isPost || "not set"}`
        );
        core.info(`Action phase: ${isPost ? "post" : "main"}`);
        core.info(`STATE_isPost: ${process.env.STATE_isPost || "not set"}`);

        if (isPost) {
            console.error("[DAGGER-ACTION] Running POST phase");
            await postAction();
        } else {
            console.error("[DAGGER-ACTION] Running MAIN phase, marking for post");
            // Mark that we'll run post
            core.saveState("isPost", "true");
            core.info("Marked for post-action execution");
            await runAction();
        }
    })();
}

// Re-export for testing
export { postAction, runAction };
