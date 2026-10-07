"use strict";
// ============================================================
// 前端入口：只导出 isomorphic 函数（无 drizzle/无 server-only）
// 前端用：import { renderArticleBlocks, articleCss } from 'ai-article-pipeline/client'
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.articleJsonLd = exports.renderShareBar = exports.renderFaqSection = exports.renderArticleLinks = exports.normalizeContentBlocks = exports.firstImageOf = exports.articleCss = exports.readingTime = exports.generateToc = exports.renderArticleCta = exports.renderArticleBlocks = exports.escapeHtml = void 0;
var utils_js_1 = require("./utils.js");
Object.defineProperty(exports, "escapeHtml", { enumerable: true, get: function () { return utils_js_1.escapeHtml; } });
Object.defineProperty(exports, "renderArticleBlocks", { enumerable: true, get: function () { return utils_js_1.renderArticleBlocks; } });
Object.defineProperty(exports, "renderArticleCta", { enumerable: true, get: function () { return utils_js_1.renderArticleCta; } });
Object.defineProperty(exports, "generateToc", { enumerable: true, get: function () { return utils_js_1.generateToc; } });
Object.defineProperty(exports, "readingTime", { enumerable: true, get: function () { return utils_js_1.readingTime; } });
Object.defineProperty(exports, "articleCss", { enumerable: true, get: function () { return utils_js_1.articleCss; } });
Object.defineProperty(exports, "firstImageOf", { enumerable: true, get: function () { return utils_js_1.firstImageOf; } });
Object.defineProperty(exports, "normalizeContentBlocks", { enumerable: true, get: function () { return utils_js_1.normalizeContentBlocks; } });
Object.defineProperty(exports, "renderArticleLinks", { enumerable: true, get: function () { return utils_js_1.renderArticleLinks; } });
Object.defineProperty(exports, "renderFaqSection", { enumerable: true, get: function () { return utils_js_1.renderFaqSection; } });
Object.defineProperty(exports, "renderShareBar", { enumerable: true, get: function () { return utils_js_1.renderShareBar; } });
Object.defineProperty(exports, "articleJsonLd", { enumerable: true, get: function () { return utils_js_1.articleJsonLd; } });
