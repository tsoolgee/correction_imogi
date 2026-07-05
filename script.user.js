// ==UserScript==
// @name         NodeBB - אימוג'י מובנה של הדפדפן (עם הסרת כפילויות)
// @namespace    tsoolgee
// @version      0.0.2
// @description  פועל אוטומטית בכל פורום מבוסס NodeBB. תמיד מציג אימוג'ים באמצעות הפונט המובנה של המערכת (ולא מתמונה מהרשת), ומזהה ומסיר כפילויות שנגרמות מבאג ידוע בפלאגין (אותו אימוג'י מוצג פעמיים - עותק שבור לצד עותק תקין) - בלי לפגוע באימוג'ים זהים שהוקלדו בכוונה פעמיים ברצף. תומך גם באימוג'ים בתפריט בחירה שנטענים ב-lazy load (data-src).
// @author       צול-גאה
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/tsoolgee/correction_imogi/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/tsoolgee/correction_imogi/main/script.user.js
// ==/UserScript==
(function () {
    'use strict';

    const EMOJI_PATH = '/assets/plugins/nodebb-plugin-emoji/emoji/';
    const DEDUPE_DELAY = 150; // ms - זמן המתנה קצר לפני בדיקת כפילויות, כדי לאפשר לבדיקת "שבור/תקין" ברקע להספיק

    // ---------- 1. זיהוי אוטומטי של פורום NodeBB (מספיק סימן אחד מתוך כמה) ----------
    function isNodeBBForum() {
        if (document.querySelector('meta[name="generator"][content*="NodeBB" i]')) return true;
        if (window.config && typeof window.config.relative_path !== 'undefined') return true;
        if (document.querySelector('script[src*="nodebb-plugin-emoji"], link[href*="nodebb-plugin-emoji"]')) return true;
        if (document.querySelector(`img[src*="${EMOJI_PATH}"], img[data-src*="${EMOJI_PATH}"]`)) return true;
        if (document.body && (document.body.hasAttribute('data-nodebb') || document.querySelector('[data-nodebb-loaded]'))) return true;
        return false;
    }

    let confirmed = isNodeBBForum();
    let styleEl = null;

    // ---------- 2. הסתרה מיידית של תמונות האימוג'י כדי שלא יבהבו/ייראו מהרשת אף לרגע ----------
    // הכלל ממוקד מאוד לנתיב הפלאגין הספציפי, ולכן לא פוגע באתרים אחרים גם אם הם לא NodeBB.
    function injectHidingCSS() {
        if (styleEl) return;
        styleEl = document.createElement('style');
        styleEl.textContent = `img[src*="${EMOJI_PATH}"], img[data-src*="${EMOJI_PATH}"] { visibility: hidden !important; }`;
        (document.head || document.documentElement).appendChild(styleEl);
    }
    injectHidingCSS();

    // ---------- 3. המרת קוד הקסדצימלי (מה-URL) לתו אימוג'י אמיתי, מוצג בפונט המובנה של המערכת ----------
    function codepointsToEmoji(codeStr) {
        try {
            const codepoints = codeStr.split('-').map(cp => parseInt(cp, 16));
            if (codepoints.some(isNaN)) return null;
            return String.fromCodePoint(...codepoints);
        } catch (e) {
            return null;
        }
    }

    // מחזיר את כתובת התמונה של אימוג'י הפורום, בין אם היא ב-src ובין אם ב-data-src
    // (בתפריטי בחירת אימוג'י התמונות בדרך כלל בטעינה עצלה - יש רק data-src, בלי src בכלל)
    function getForumEmojiUrl(img) {
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && dataSrc.includes(EMOJI_PATH)) return dataSrc;
        if (img.src && img.src.includes(EMOJI_PATH)) return img.src;
        return null;
    }

    function isForumEmojiImg(img) {
        return !!getForumEmojiUrl(img);
    }

    // .../emoji/apple/2705.png?v=xxx  ->  2705
    function extractCodeFromSrc(src) {
        const match = src.match(/\/emoji\/[^/]+\/([0-9a-fA-F-]+)\.png/);
        return match ? match[1] : null;
    }

    // בדיקה אסינכרונית ברקע בלבד - האם ה-URL המקורי בפועל תקין או שבור.
    // זה *לא* לצורך תצוגה (המשתמש תמיד רואה תו יוניקוד מהפונט המובנה, מיידית וללא המתנה),
    // אלא רק כדי להבחין בין כפילות-באג (שבור+תקין) לבין הקלדה כפולה מכוונת (שניהם תקינים).
    function checkBrokenAsync(src) {
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = () => resolve(false);  // תקין
            probe.onerror = () => resolve(true);   // שבור
            probe.src = src;
        });
    }

    let pendingChecks = [];

    function replaceEmojiImg(img) {
        if (img.dataset.emojiReplaced) return;
        const originalSrc = getForumEmojiUrl(img);
        if (!originalSrc) return;
        img.dataset.emojiReplaced = '1';

        const code = extractCodeFromSrc(originalSrc);
        if (!code) return;

        const emojiChar = codepointsToEmoji(code);

        // מנתקים מיידית את התמונה מהמקור - גם src (אם קיים) וגם data-src.
        // חשוב להסיר גם data-src, אחרת ספריית הטעינה העצלה (lazy load) של הפורום
        // עלולה עדיין להעתיק אותו ל-src מאוחר יותר ולגרום להורדה מיותרת מהרשת,
        // ולפעמים אף לגרום להבהוב של התמונה השבורה/המקורית לפני ההחלפה.
        img.removeAttribute('src');
        img.removeAttribute('data-src');

        let node = img;
        if (emojiChar) {
            const span = document.createElement('span');
            span.textContent = emojiChar;
            span.className = 'native-emoji-replaced';
            span.style.fontFamily = '"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji",sans-serif';
            span.style.fontStyle = 'normal';
            span.dataset.emojiCode = code;
            if (img.alt) span.title = img.alt;
            img.replaceWith(span);
            node = span;
        } else {
            img.dataset.emojiCode = code;
        }

        // הבדיקה עצמה רצה ברקע - לא מעכבת ולא משפיעה על מה שהמשתמש רואה על המסך
        pendingChecks.push(
            checkBrokenAsync(originalSrc).then(wasBroken => {
                node.dataset.wasBroken = wasBroken ? '1' : '0';
            })
        );
    }

    // ---------- 4. הסרת כפילויות שנגרמות מהבאג בלבד (לא כפילויות שהוקלדו בכוונה) ----------
    function adjacentElement(el, direction) {
        let n = direction === 'next' ? el.nextSibling : el.previousSibling;
        while (n) {
            if (n.nodeType === 1) return n;
            if (n.nodeType === 3 && n.textContent.trim() !== '') return null; // טקסט אמיתי בדרך - לא שכנים
            n = direction === 'next' ? n.nextSibling : n.previousSibling;
        }
        return null;
    }

    function dedupePass() {
        document.querySelectorAll('[data-emoji-code]').forEach(node => {
            if (!node.isConnected) return;
            const code = node.dataset.emojiCode;
            for (const dir of ['next', 'previous']) {
                const sib = adjacentElement(node, dir);
                if (sib && sib.dataset && sib.dataset.emojiCode === code) {
                    const bothLoadedFine = node.dataset.wasBroken === '0' && sib.dataset.wasBroken === '0';
                    if (bothLoadedFine) continue; // שני עותקים תקינים = הוקלד בכוונה פעמיים, לא נוגעים
                    // לפחות אחד מהם שבור -> זו כפילות-הבאג, משאירים רק את הראשון לפי סדר ה-DOM
                    const later = (node.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING) ? sib : node;
                    later.remove();
                    if (later === node) return;
                }
            }
        });
    }

    let dedupeTimer = null;
    function scheduleDedupe() {
        clearTimeout(dedupeTimer);
        dedupeTimer = setTimeout(() => {
            const checks = pendingChecks;
            pendingChecks = [];
            Promise.all(checks).then(dedupePass);
        }, DEDUPE_DELAY);
    }

    function scanNode(node) {
        if (!node || node.nodeType !== 1) return;
        if (node.tagName === 'IMG') {
            replaceEmojiImg(node);
        } else if (node.querySelectorAll) {
            node.querySelectorAll('img').forEach(replaceEmojiImg);
        }
        scheduleDedupe();
    }

    // ---------- 5. הפעלה בפועל - רק אחרי אישור שמדובר בפורום NodeBB ----------
    function start() {
        if (!confirmed) confirmed = isNodeBBForum();
        if (!confirmed) {
            if (styleEl) styleEl.remove(); // לא NodeBB - מנקים ולא נוגעים בעמוד בכלל
            return;
        }
        scanNode(document.body);
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(scanNode);
                } else if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG') {
                    // תופס מקרה קצה: ספריית טעינה עצלה של הפורום הספיקה להוסיף/לשנות
                    // data-src או src לפני שהספקנו להחליף את התמונה
                    replaceEmojiImg(m.target);
                    scheduleDedupe();
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data-src']
        });
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
