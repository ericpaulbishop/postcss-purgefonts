# PostCSS PurgeFonts


[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]


[PostCSS] plugin desgned to remove unused characters from fonts, particularly icon fonts such as FontAwesome. This works best when coupled with the PurgeCSS plugin to eliminate unused CSS styles.


## Features

- Identifies all Unicode Characters present in content properties of your CSS
- Optionally scan additional files for Unicode Characters to preserve, if the 'content' variable is specified in configuration
- Additional characters to always retain can be specified with the preserve\_glyphs variable
- Identifies all @font-face declarations in your CSS, and purges all glyphs that do not correspond to a unicode character that you are preserving so long as the font contains at least one of these glyphs
- Using the purge\_only\_fonts declaration you may specify only a subset of fonts to purge
- Files are written to a directory specified by 'to' parameter, or the 'fonts' subdirectory of your postcss output directory if no parameter is specified to the plugin
- @font-face rules are updated to reflect new locations of the file
- New file names contain a hash based on the file's content so that if the file changes, the URL of the file will change and thus old version will not be loaded from the cache
- @font-face declarations that are not purged, will be copied to the new font directory without modification, but with the hashed file name for cache busting.
- Additionally, all web based font types (woff2,woff,ttf, svg, eot) will be created for all font declarations, even those that are not purged of glyphs.
- You may specify font declarations to ignore entirely (not change at all, even to add cache-busting hash) in the ignore\_fonts parameter
- By default fonts specfied by URL are completely ignored, however you can set the ignore\_url parameter to false to download and process them


Consider the following css: 
```css
@font-face {
  font-family: 'Font Awesome 5 Free';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("test_font_dir/fa-regular-400.eot");
  src: url("test_font_dir/fa-regular-400.eot") format("embedded-opentype"), url("test_font_dir/fa-regular-400.woff2") format("woff2"), url("test_font_dir/fa-regular-400.woff") format("woff"), url("test_font_dir/fa-regular-400.ttf") format("truetype"), url("test_font_dir/fa-regular-400.svg") format("svg"); 
}
.far {
  font-family: 'Font Awesome 5 Free';
  font-weight: 400; 
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
  display: inline-block;
  font-style: normal;
  font-variant: normal;
  text-rendering: auto;
  line-height: 1; 
}


.fa-user:before {
  content: "\f007"; 
}

```

If the only glyph that you are using is the user icon (unicode point 0xf007), then this plugin will shrink the font file sizes down so that unused glyphs are not included. The fonts will be compressed, removing the unneeded glyphs, and the @font-face will become something like this:

```css
@font-face {
  font-family: 'Font Awesome 5 Free';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("fonts/fa-regular-400-257162bc.eot");
  src: url("fonts/fa-regular-400-257162bc.eot") format("embedded-opentype"), url("fonts/fa-regular-400-68b898ee.woff2") format("woff2"), url("fonts/fa-regular-400-d9e64121.woff") format("woff"), url("fonts/fa-regular-400-db847f59.ttf") format("truetype"), url("fonts/fa-regular-400-65855054.svg") format("svg"); 
}
```


This project is intended as an improved version of the fontmin-webpack plugin intended for use with any project that uses PostCSS (which can
be used with webpack), rather than limited exclusively to webpack projects.

Unlike the fontmin-webpack plugin, this plugin can automatically do cache-busting, renaming the compressed font files to include a hash so that the urls will change if the content of the files change. Additionally, glyphs to retain can be extracted from additional files rather than exclusively from the content properties of CSS styles.

Additionally, this plugin can be used to download and process font URLs. By default, this option is not enabled, but can be enabled by setting 'ignore\_urls' to false






## Usage

Add the plugin to your plugins list in postcss.config.js, along with configuration options.

If you use this plugin along with postcss-purgcss (e.g. to purge unused FontAwesome CSS), you probably
want to run this plugin *after* purgecss, so the unused font styles have already been purged and you only
keep the glyphs you use.

```diff
 module.exports = {
   plugins: [
     require('postcss-import'),
     require('autoprefixer'),
     require('postcss-purgecss')({
       content: ['./public/**/*.html'],
       fontFace: true,
       defaultExtractor: content => content.match(/[A-Za-z0-9-_:/]+/g) || []
+    }),
+    require('postcss-purgefonts')( {
+      'purge_only_fonts': ['Font Awesome 5 Free', 'Font Awesome 5 Brands']
     })
   ]
 }
```

## Options

**`to (default='fonts/')`**:

If this is specified, this is the output directory for font files created by this plugin. If this is not an absolute path, the output path will be relative to the CSS output directory. If unspecified, the output directory for fonts will be the fonts sub-directory.

**`purge_only_fonts (default=[])`**: 

List of font family names, as defined in the CSS font-family property of the @font-family definition that should be compressed to only the unicode characters identified in scan. If this is empty, all fonts will be compressed, otherwise, only these fonts will be compressed.

**`ignore_fonts (default=[])`**:

List of font family names, as defined in the CSS font-family property of the @font-family definition that should not be altered in any way, and have no files moved to the output font directory.

**`preserve_fonts (default=[])`**:

List of font family names, as defined in the CSS font-family property of the @font-family definition that should be copied to output directory, but not compressed. If you specify purge\_only\_fonts, this should not be necessarry. If purge\_only\_fonts is not specified, this can be used to prevent specified fonts from being compressed.

**`preserve_glyphs (default=[])`**:

List of characters and/or integers (unicode code points) to preserve when compressing font files, in addition to the ones found during scan. These can be specified as characters (strings) or integer unicode points. Please be aware that any string included in the array should have only one character, only the first character will be considered. Include multiple characters in the array instead of a string with multiple characters.

**`content (default=[])`**:

Example: 
```js
[ 
  {'scan_type': 'html_escaped', 'files':['test/test_assets/**/*.html']}, 
  {'scan_type': 'unescaped', 'min': 0xff, 'max': 0xffff, 'files':['test/test_assets/**/*.html', 'test/test_assets/**/*.txt']}   

]
```

The content property should be defind as a list of objects, each of which *must* have the `files` attribute defined, with the `scan_type`, `min`, and `max` variables optional.

Each entry represents a set of files to be scanned for unicode characters, which match any of the glob expressions defined in the `files` attribute list.

`files`: A list of "glob" strings to identify files to scan

`scan_type (default='unescaped')`: This can be 'unescaped' or 'html\_escaped' and indicates whether to scan bare characters ('unescaped') or in the format of an html defined unicode codepoint e.g. '&\#xf007;' or '&\#62198;' ('html\_escaped')

`min`: An integer, the minimum, inclusive, unicode code point to include if seen. Characters/Code Points below this value will be ignored unless they are found in a different scan, in a CSS content property or in the `preserve_glyphs` list.

`max`: An integer, the maximum, inclusive, unicode code point to include if seen. Characters/Code Points above this value will be ignored unless they are found in a different scan, in a CSS content property or in the `preserve_glyphs` list.


**`cache_busting (default='file')`**: 

This specifies if and how cache-busting is performed. 

A value of 'file' indicates that hashes will be part of the output file name. 

A value of 'query' indicates that hashes will be appended as query strings rather than being part of the output file names. Be warned, this means matching the values in the src urls as font types requires a more complex regular expression, instead of just looking at the last three character extension. That's why this isn't the default behavior.

A value of 'none' means no cache-busting will take place.

**`ignore_urls (default=true)`**:

Completely ignore fonts specified as a url rather than a local file, if true, which is the default. Otherwise, download the urls and process like any other font file depending on fonts specified in `purge_only_fonts` and `preserve_fonts` parameters.

**`preserve_all_on_zero_matching_glyphs (default=true)`**:

When font is identified that contains none of the glyphs to be preserved, preserve all glyphs if this parameter is set to true, which is the default. Otherwise, only one random character will be preserved, unless `ignore_all_on_zero_matching_glyphs` is set to true

**`ignore_all_on_zero_matching_glyphs (default=false)`**:

When font is identified that contains none of the glyphs to be preserved, do not alter definition at all, and do not copy font files to output directory.

**`preserve_ascii (default=false)`**:

When compressing font files, always preserve all ASCII characters with unicode code points less than 128.



[PostCSS]: https://github.com/postcss/postcss
[official docs]: https://github.com/postcss/postcss#usage



[npm-url]: https://npmjs.org/package/postcss-purgefonts
[npm-image]: http://img.shields.io/npm/v/postcss-purgefonts.svg

[travis-url]: https://travis-ci.org/ericpaulbishop/postcss-purgefonts
[travis-image]: http://img.shields.io/travis/ericpaulbishop/postcss-purgefonts.svg

[downloads-image]: http://img.shields.io/npm/dm/postcss-purgefonts.svg
