// Banner screen glow: tells the CSS (screen-glow.css) where the mouse is
// inside each screen link, so the hover glow can follow it. Only runs on
// devices with a real hover-capable mouse; touch layouts are untouched.
(function () {

    "use strict";

    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        return;
    }

    function place(screen, event) {

        const rect = screen.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
            return;
        }

        screen.style.setProperty("--mx", ((event.clientX - rect.left) / rect.width * 100) + "%");
        screen.style.setProperty("--my", ((event.clientY - rect.top) / rect.height * 100) + "%");

    }

    document.querySelectorAll(".screen-button").forEach(function (screen) {

        // Position the glow under the cursor the instant it enters, so it
        // fades in where the mouse is rather than sliding in from wherever
        // it last was. It's deliberately NOT reset when the mouse leaves:
        // the glow just fades out where it is (resetting it to the middle
        // made it visibly jump back while fading).
        screen.addEventListener("mouseenter", function (event) {
            place(screen, event);
        });

        screen.addEventListener("mousemove", function (event) {
            place(screen, event);
        });

    });

})();
