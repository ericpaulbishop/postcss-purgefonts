const fs = require('fs')
const pathTools = require('path')
const mkdirp = require('mkdirp')
const glob = require('glob')
const postcss = require('postcss')
const fonteditor = require('fonteditor-core')
const hasha = require('hasha')
const otf2svg = require('otf2svg')
const got = require('got')

const debugLogEnabled = false

function debugLog( sendToConsoleLog ) {
  if(debugLogEnabled) {
    console.log( sendToConsoleLog )
  }
}



function initOptions(pluginOptions, postcssOptions) {
  
  const defaultOptions = {
    purge_only_fonts: [],
    ignore_fonts: [],
    preserve_fonts: [], 
    preserve_glyphs: [], 
    content: [],
    ignore_urls: true,
    preserve_all_on_zero_matching_glyphs: true,
    ignore_all_on_zero_matching_glyphs: false,
    preserve_ascii: false,
    cache_busting: "file" //"file", "query", "none"
  };
  const defaultKeys = Object.keys(defaultOptions)

  let options = pluginOptions || {}
  for(let dki=0; dki < defaultKeys.length; dki++) {
    let key = defaultKeys[dki]
    if( options[key] == null ) { //format_load_order should be internal-only value
      options[key] = defaultOptions[key]
    }
  }

  //both ignore_on_zero and preserve_on_zero can't both be true
  if(options['ignore_on_zero_matching_glyphs'] == true) { 
    options['preserve_on_zero_matching_glyphs'] = false;
  }

 
  // define absolute and relative to/from paths here, which we use elsewhere
  // these are internal values based on user-defined to, which are not set directly by user
  let pathAdjRegex = new RegExp(pathTools.sep, 'g')
  let postcssTo =  (postcssOptions.to ? pathTools.dirname(postcssOptions.to) :  pathTools.dirname(postcssOptions.from)).replace(pathAdjRegex, '/') 
  options['relative_to'] = options.to ? options.to.replace(pathAdjRegex, '/') : "fonts" 
  options['absolute_to'] = (options['relative_to']).charAt(0) == '/' ? options['relative_to'] : postcssTo + "/" + options['relative_to']

  //cache businting must be one of three valid options, if it doesn't match set it to none
  options['cache_busting'] = options['cache_busting'].toLowerCase()
  options['cache_busting'] = options['cache_busting'] == 'file' || options['cache_busting'] == 'query' ? options['cache_busting'] : "none"

  //other internal global constants 

  options['format_load_order'] = [
      {fmt:'truetype', ext:'ttf'}, 
      {fmt:'opentype', ext:'otf'}, 
      {fmt:'svg', ext:'svg' }
      ];

  options['format_output_order'] = [
      {fmt:'embedded-opentype', ext:'eot'},
      {fmt:'woff2', ext:'woff2'},
      {fmt:'woff', ext:'woff'},
      {fmt:'truetype', ext:'ttf'}, 
      {fmt:'svg', ext:'svg'}
      ];

  return options
}

function forceRemove(removePath) {
  if(fs.existsSync(removePath)) {
    try{ fs.unlinkSync(removePath); }catch(e){}
  }
}

function findGlyphs(cssRoot) {
  var glyphs = {}
  cssRoot.walkDecls( /^content$/i, (decl) => {
    let remainder = decl.value.match(/["'][ ]*$/) ? decl.value.replace(/^[ ]*["']/, '').replace(/["'][ ]*$/, '') : decl.value
    let escapedMatches = remainder.match(/\\[0-9A-Fa-f]{2,6}/ig) || []
    for(let emi=0; emi < escapedMatches.length; emi++) {
      debugLog("ESCAPED MATCH: " + escapedMatches[emi])
      let glyph = String.fromCodePoint(parseInt(escapedMatches[emi].substr(1), 16)) 
      glyphs[glyph] = true
      remainder = remainder.replace(escapedMatches[emi], '')
    }
    for(let ri=0; ri < remainder.length; ri++) {
      let codePoint =  remainder.codePointAt(ri) 
      let glyph = String.fromCodePoint( codePoint );
      if(codePoint > 0xffff) { ri = ri+1; }
      debugLog("glyph = '" + glyph + "'")
      glyphs[glyph] = true
    }
  });

  let glyphArr = Object.keys(glyphs);
  debugLog("found " + glyphArr.length + " glyphs");
  return glyphArr;
}

function extractContentGlyphs(options, currentGlyphs) {
  let glyphs = createMap(currentGlyphs);

  let sources = options.content
  for(let si=0; sources != null && si < sources.length; si++){
    let source = sources[si];
    let min = source.min ? source.min : 20
    let max = source.max ? source.max : 0xffffffff
    min = typeof(min) == 'string' ? min.codePointAt(0) : min
    max = typeof(max) == 'string' ? max.codePointAt(0) : max
    let scanType = source.scan_type == 'html_escaped' ? source.scan_type : 'unescaped'
    let globPatterns = source.files
    for(let gpi=0; gpi < globPatterns.length; gpi++) {
     let files = glob.sync(globPatterns[gpi])
      
      for(let fi=0; fi < files.length; fi++) {
        try {
          let fileContents = fs.readFileSync(files[fi]).toString();
          if(scanType == 'html_escaped') {
            let escapedHexMatches = fileContents.match(/&#[Xx][0-9A-Fa-f]{2,6};/ig)
            let escapedDecMatches = fileContents.match(/&#[0-9]{2,8};/ig)

            for(let ehmi=0; ehmi < escapedHexMatches.length; ehmi++) {
              let codePoint = parseInt( escapedHexMatches[ehmi].toLowerCase().replace(/^&#x/, '').replace(/;$/, ''), 16)
              if(codePoint >= min && codePoint <= max) { 
                glyphs[ String.fromCodePoint(codePoint) ] = true;
              }
            }
            for(let edmi=0; edmi < escapedDecMatches.length; edmi++) {
              let codePoint = parseInt( escapedDecMatches[edmi].toLowerCase().replace(/^&#/, '').replace(/;$/, ''), 10)
              if(codePoint >= min && codePoint <= max) { 
                glyphs[ String.fromCodePoint(codePoint) ] = true;
              }
            }
          } else {
            for(let fci=0; fci < fileContents.length; fci++) {
              let codePoint = fileContents.codePointAt(fci);
              if(codePoint > 0xffff) {
                fci++
              }
              if(codePoint >= min && codePoint <= max && codePoint >= 0x20) { 
                glyphs[ String.fromCodePoint(codePoint) ] = true;
              }
            }
          }
        }catch(err){  }
      }
    }
  }

  let glyphArr = Object.keys(glyphs);
  return glyphArr;

}



function parseFontSrc(srcStr, srcRootPath, previousFontFiles ) {
  let fontFiles = previousFontFiles || {}
  let srcParts = srcStr.replace(/[\r\n\t]+/gm, " ").split(/url[ ]*\([ ]*/ig)


  for(let spi=0; spi < srcParts.length; spi++) {
    let srcPart = srcParts[spi]
    if(srcPart.match(/\)/)) { 
      let srcPath = srcPart.replace(/\)[ ]+format[ ]*\(.*$/ig, '')
        .replace(/;.*$/, '')
        .replace(/^["']*/, '')
        .replace(/["' )]*$/, '')
        .replace(/#.*$/, '')
        .replace(/\?.*$/, '');
  
      let srcExtension = srcPath.replace(/^.*\./g, '').toLowerCase()
  
  
      let srcFormat = null
      if(srcPart.match(/\)[ ]+format[ ]*\(.*$/ig)) {
        srcFormat = srcPart.replace(/^.*\)[ ]+format[ ]*\([ ]*["']*/ig, '')
        .replace(/["']*[ ]*\)[ ]*[,;]*[ ]*$/, '')
      }
      
      let fullSrcPath = srcPath.match(/^https?:\/\//i) ? srcPath : srcRootPath + "/" + srcPath;
      if(fontFiles[fullSrcPath] == null ) {
        fontFiles[fullSrcPath] = { path: fullSrcPath, extension: srcExtension }
      }
      if(srcFormat != null) {
        fontFiles[fullSrcPath]['format'] = srcFormat
      }
    }
  }

  return fontFiles
}


function createMap(arr, keyAttr, valAttr) {
  let retMap = {}
  if(arr != null) {
    for(let ai=0; ai < arr.length; ai++) {
      let key = keyAttr == null ? arr[ai] : (arr[ai])[keyAttr]
      let val = valAttr == null ? true : (arr[ai])[valAttr]
      if(key != null) {
        retMap[key] = val
      }
    }
  }
  return retMap
}


function getTruetypeCodePoints(path) {

  let codePoints = []
  try {


    let inputBuffer = fs.readFileSync(path);
    let font = fonteditor.Font.create(inputBuffer, { type: 'ttf' });
    let fontData = font.get();
    
    let badGlyphNames = createMap([ '.notdef', '.null', 'nonmarkingreturn' ])
    let fontGlyphData = fontData['glyf']
    let fontCharMap = fontData['cmap']
    let candidateCodePoints = Object.keys(fontCharMap)
    
  
    for(let ccpi=0; ccpi < candidateCodePoints.length; ccpi++) {
      let candidate = candidateCodePoints[ccpi]
      let candidateGlyphIndex = fontCharMap[ candidate ]
      let candidateName = fontGlyphData[candidateGlyphIndex]['name']
      if(badGlyphNames[candidateName] == null) {
        codePoints.push( parseInt(candidate, 10) )
      }
    }

  } catch (err) {
    debugLog("FONTEDITOR-CORE ERROR LOADING CODE POINTS: " + err);

  }

  return codePoints.sort()
}


function convertToTruetype(srcPath, destPath, srcFormat) {

  try {
      
    let rawInput = null; // fs.readFileSync(srcPath)
    let fontObject = null


    switch(srcFormat.toLowerCase()) {
      case 'opentype':
      case 'otf':
        rawInput = otf2svg.convert(srcPath)
        break
      case 'svg':
        rawInput = fs.readFileSync(srcPath)
        break;
    }
    if(rawInput != null) {
      fontObject = fonteditor.svg2ttfobject( rawInput.toString('utf-8') )
      let ttfBuffer = new fonteditor.TTFWriter().write(fontObject);
      fs.writeFileSync(destPath, Buffer.from(ttfBuffer))
    }

 } catch(err) {
   debugLog("FONTEDITOR-CORE ERROR CONVERTING TO TTF [src format: " + srcFormat + ", src file: " + srcPath + "] :\n" + err)

 }


  return fs.existsSync(destPath)
}







function purgeTruetypeGlyphs(srcPath, destPath, glyphs, saveHinting) {

  try {

    let codePoints = []
    for(let gi=0; gi < glyphs.length; gi++) {
      codePoints.push( (glyphs[gi]).codePointAt(0) )
    }


  
    let inputBuffer = fs.readFileSync(srcPath);
    // read font data
    let fontObject = fonteditor.Font.create(inputBuffer, {
      type: 'ttf', // support ttf, woff, woff2, eot, otf, svg
      subset: codePoints, // only read glyphs with these codepoints 
      hinting: saveHinting, // save font hinting
      compound2simple: false, // transform ttf compound glyf to simple
      inflate: null, // inflate function for woff
      combinePath: false, // for svg path
    });
  
    let outputBuffer = fontObject.write( {
      type: 'ttf',
      hinting: saveHinting, // save font hinting
    });
    fs.writeFileSync(destPath, outputBuffer);
  
  } catch(err) {
    debugLog("FONTEDITOR-CORE ERROR PURGING GLYPHS: " + err);
  }
  return fs.existsSync(destPath)

}





function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function convertFromTruetype(srcPath, destPath, destFormat) {
  
  
  let oldStdoutWrite = null;
  let oldStderrWrite = null
  let outputErr = null
  let convertModule = null

  switch(destFormat.toLowerCase()) {
    case 'embedded-opentype':
    case 'eot':    
      convertModule = 'eot'
      break;
    case 'woff':
    case 'svg':
    case 'woff2':
      convertModule = destFormat.toLowerCase()
      break;
  }
  try {
    
    debugLog("converting to " + destFormat);
  
    if(convertModule == 'woff2') {
      await fonteditor.woff2.init();
    }
  
    let rawInput = fs.readFileSync(srcPath)
    let fontObject = fonteditor.Font.create( rawInput, { type: 'ttf' } )
    let outputBuffer = Buffer.from(fontObject.write( { type: convertModule } ))
    fs.writeFileSync(destPath, outputBuffer)
    
  } catch(err) {
    outputErr = "FONTEDITOR-CORE ERROR CONVERTING TTF TO [format: " + destFormat + ", file: " + destPath + "] :\n" + err 
  }
  
  if(outputErr) {
    debugLog(outputErr)
  }
  return fs.existsSync(destPath)
}

async function downloadUrl(url, path) {

  let downloaded = false;
  try {
    let result = await got.get(url, {timeout:90*1000})
    forceRemove(path);
    fs.writeFileSync(path, result.rawBody);
    downloaded = fs.existsSync(path);
  } catch(err) { console.warn("DOWNLOAD ERROR: " + err); }
  return downloaded;
}



async function analyzeFont(options, glyphs, fontFiles, fontFamily) {

  let analysis = {}
  analysis['final_glyph_set'] = []
  analysis['ttf_src_path'] = null
  analysis['ttf_src_is_temporary'] = false;
  analysis['action'] = 'process' // can be: 'ignore', 'preserve' or 'process' 
                                   // ignore: do nothing, preserve: copy files exactly, process: minimize glyphs in files)


  // create lookup maps based on format / extension
  let fontData = Object.values(fontFiles)
  let formatToFontPath = createMap( fontData, 'format', 'path')
  let extensionToFontPath = createMap( fontData, 'extension', 'path')

  debugLog(formatToFontPath)
  debugLog(extensionToFontPath)

  //find ttf source, converting another format to ttf if necessary
  for(let floi=0; floi < options['format_load_order'].length && analysis['ttf_src_path'] == null; floi++) {
    let testFmt =  options['format_load_order'][floi]
    let testPath = formatToFontPath[ testFmt.fmt ] ? formatToFontPath[ testFmt.fmt ] : extensionToFontPath[ testFmt.ext ]
    let testPathIsTmp = false;

    if(options.ignore_urls != true && testPath != null && testPath.match(/^https?:\/\//i)) {

      let tmpFile = testPath.replace(/^.*[/\\]/g, '').replace(/\?.*$/, '').replace(/#.*$/, '')
      tmpFile = tmpFile.toLowerCase().endsWith("." + testFmt.ext) ? tmpFile : tmpFile + "." + testFmt.ext;
      let tmpPath = options['absolute_to'] + "/" + tmpFile
      let fetched = false
      try {
        await downloadUrl(testPath, tmpPath)
        fetched = fs.existsSync(tmpPath);
      } catch(err){ console.log("ERR= " + err); }
      if(fetched) {
        testPath = tmpPath
        testPathIsTmp = true
      }
    }
    
    if(fs.existsSync(testPath)) {

      if(testFmt.fmt == 'truetype') {
        //already truetype
        if(testPathIsTmp) {
          let newTestPath = testPath + ".ttf"
          forceRemove(newTestPath);
          fs.renameSync(testPath, newTestPath)
          analysis['ttf_src_path'] = newTestPath
          analysis['ttf_src_is_temporary'] = true;

        } else {
          analysis['ttf_src_path'] = testPath
        }

      } else {
        //convert to truetype
        let tmpTtfPath = options['absolute_to'] + "/" + testPath.replace(/^.*[/\\]/g, '') + ".ttf"
        if(convertToTruetype(testPath, tmpTtfPath, testFmt.fmt)) {
            analysis['ttf_src_is_temporary'] = true;
            analysis['ttf_src_path'] = tmpTtfPath
        }
      }
      if(testPathIsTmp) {
          forceRemove(testPath)
      }
    }
  }


  let processOnlyFontMap = options.purge_only_fonts.length > 0 ? createMap(options.purge_only_fonts) : null;
  let preserveFontMap    = createMap(options.preserve_fonts);
  let ignoreFontMap      = createMap(options.ignore_fonts);

  if(analysis['ttf_src_path'] == null || ignoreFontMap[fontFamily]) {

    // explicitly ignored or no ttf font path to valid file
    // assume file will show up after postcss processing
    // therefore we ignore
    analysis['action'] = 'ignore'
  
  } else {

    //analyze glyphs in font and decide what needs to be kept / purged
    let fontGlyphCodePoints = getTruetypeCodePoints(analysis['ttf_src_path'])
    let fontCodePointMap = createMap(fontGlyphCodePoints)

    //debugLog("size of character set = " + fontGlyphCodePoints.length)

  
    let glyphsToKeep = []
    let glyphsToKeepIfProcessed = {}
  
    for(let gi=0; gi < glyphs.length; gi++) {
      let g = glyphs[gi]
      if(fontCodePointMap[ g.codePointAt(0) ]) {
        glyphsToKeep.push(g)
        glyphsToKeepIfProcessed[g] = true
      }
    }
  
    for(let pgi=0; pgi< options.preserve_glyphs.length; pgi++) {
      let g = options.preserve_glyphs[pgi]
      let gcp = typeof(g) == 'string' ? g.codePointAt(0) : g
      g = String.fromCodePoint(gcp)
      if( fontCodePointMap[ gcp ]) {
        glyphsToKeepIfProcessed[g] = true
      }
    }
  
    if(options.preserve_ascii) {
      for(let chCode=0; chCode < 255; chCode++) {
        let g = String.fromCharCode(chCode)
        if( fontCodePointMap[ chCode ]) {
          glyphsToKeepIfProcessed[g] = true
        }
      }
    }
 

 
    if( (glyphsToKeep.length == 0 && options.ignore_all_on_zero_matching_glyphs) ) {
  
      //ignore definition, preserve css exactly
      analysis['action'] = 'ignore'
  
  
    } else if( (glyphsToKeep.length == 0 && options.preserve_all_on_zero_matching_glyphs) || 
               preserveFontMap[fontFamily] ||
               (processOnlyFontMap != null && (!processOnlyFontMap[fontFamily]))
               ) { 
  
      //copy font file to destination without processing and update css src definition
      analysis['action'] = 'preserve'
  
    } else {
  
      //process font, removing glyphs and update src definition
      //if there are no valid glyphs, we add just the first one in the font definition
      analysis['action'] = 'process'

      analysis['final_glyph_set'] = Object.keys(glyphsToKeepIfProcessed).sort()


      if(analysis['final_glyph_set'].length == 0) {
        (analysis['final_glyph_set']).push( String.fromCodePoint( fontGlyphCodePoints[0] )   );
      }
  
    }
  }
  
  return analysis;
}


//deletes all but specified file in the same directory that have the same root path and extension
function cleanSimilarFiles(saveFilePath, root, extension) {
  let dir = saveFilePath.match(/[\\/]/) ? saveFilePath.replace(/[^\\/]*$/, '') : './';
  root = root.replace(/^.*[\\/]/, '')
  let saveFileName = saveFilePath.replace(/^.*[\\/]/, '')
  let files = fs.readdirSync(dir)
  for(let fi=0; fi < files.length; fi++) {
    let file = files[fi];
    if(file != saveFileName && file.startsWith(root) && file.endsWith(extension)) {
      forceRemove(dir + file);
    }
  }
}


async function absolutePathToUrl( options, path, format, isBareEot) {
  
  let url = ''
  let cacheBuster = ""
  try {
    if(options.cache_busting == "query") {

      //let pathFileHash = await hasha.fromFile(path, {algorithm: 'sha256'})

      cacheBuster = "?fonthash=" + await hasha.fromFileSync(path, {algorithm: 'sha256'}).substr(-8); //last 8 characters of sha256 hash
    }
  }catch(e) { debugLog("HASH ERROR : " + e); }

  let urlPath = options['relative_to'] + "/" + path.replace(/^.*\//, '') 
  if(format == 'embedded-opentype' && isBareEot) {
    url = "url(\"" + urlPath + cacheBuster + "\")"
  } else {
    let args = (cacheBuster == "" && format == 'embedded-opentype') ? '?#iefix' : cacheBuster
    url = "url(\"" + urlPath + args + "\") format(\"" + format + "\")"
  }
  return url
} 

async function processFontAndGenerateSrcs(options, fontFiles, fontAnalysis, oldSrcs) {
  let newSrcs = []

  
  if(fontAnalysis['action'] == 'ignore') {

    //on ignore, do nothing but return old srcs
    newSrcs = oldSrcs

  }
  else {



    // if we're processing files, first proces the "master" ttf file 
    // which will serve as the template for others
    let finalTtfDest = options['absolute_to'] + "/" + (fontAnalysis['ttf_src_path']).replace(/^.*\//, '')
    
    if( fontAnalysis['ttf_src_is_temporary'] ) {
      finalTtfDest = finalTtfDest.replace(/\.[^.]*$/, '').replace(/\.[^.]*$/, '') + ".ttf"
    } else {
      finalTtfDest = finalTtfDest.replace(/\.[^.]*$/, '') + ".ttf"
    }

    debugLog("DESTINATION = " + finalTtfDest)

    if(fontAnalysis['action'] == 'process') {
      let processSuccess = purgeTruetypeGlyphs( fontAnalysis['ttf_src_path'], finalTtfDest, fontAnalysis['final_glyph_set'], !fontAnalysis['ttf_src_is_temporary']);
      if(!processSuccess) {
        console.warn("FAILED TO PURGE GLYPHS FROM TTF");

        fontAnalysis['action'] = ['preserve']

      } else
      {
        debugLog("SUCCESSFULLY PURGED GLYPHS FROM TTF, dest = " + finalTtfDest)
      }
    }
    if(fontAnalysis['action'] == 'preserve' )  {
       fs.copyFileSync(fontAnalysis['ttf_src_path'], finalTtfDest);
    }

    let destRoot = finalTtfDest.replace(/\.[^.]*$/, '')
    if(fs.existsSync(finalTtfDest)) {
      cleanSimilarFiles(finalTtfDest, destRoot, ".ttf")
    }
    if(fs.existsSync(finalTtfDest) && options.cache_busting == "file") {
      
      let cacheBustingTtfDest = destRoot + "-" + (await hasha.fromFileSync(finalTtfDest, {algorithm: 'sha256'}).substr(-8)) + ".ttf"
      forceRemove(cacheBustingTtfDest)
      fs.renameSync(finalTtfDest, cacheBustingTtfDest)
      finalTtfDest = cacheBustingTtfDest;
    }

    if(fs.existsSync(finalTtfDest)) {
      let mainSrcParts = []
      let fontData = Object.values(fontFiles)
      let formatToFontPath = createMap( fontData, 'format', 'path')
      let extensionToFontPath = createMap( fontData, 'format', 'path')
  
      debugLog("doing output");


      for(let fooi=0; fooi < options['format_output_order'].length ; fooi++) {

        let fmt = options['format_output_order'][fooi]
        let oldFile = formatToFontPath[fmt.fmt] ? formatToFontPath[fmt.fmt] : extensionToFontPath[fmt.ext]
        let oldFileExists = fs.existsSync(oldFile)
        let dest = fmt.fmt == 'truetype' ? finalTtfDest : destRoot + "." + fmt.ext

        debugLog("NEXT FORMAT: " + fmt.fmt + ", dest=" + dest)

        if(fmt.fmt != 'truetype') {
          
          if(fontAnalysis['action'] == 'preserve' && oldFileExists) {
            fs.copyFileSync(oldFile, dest)
          } else {
            await convertFromTruetype(finalTtfDest, dest, fmt.fmt);
          }
        
          if(fs.existsSync(dest)) {
             cleanSimilarFiles(dest, destRoot, fmt.ext) 
          }
          if(fs.existsSync(dest) && options.cache_busting == "file") {
            let cacheBustingDest = destRoot + "-" + (await hasha.fromFileSync(dest, {algorithm: 'sha256'}).substr(-8)) + "." + fmt.ext
            forceRemove(cacheBustingDest)
            fs.renameSync(dest, cacheBustingDest)
            dest = cacheBustingDest;
          }
        }
        
        if(fs.existsSync(dest)) {
          mainSrcParts.push( await absolutePathToUrl(options, dest, fmt.fmt, false) )
          if(fmt.fmt == "embedded-opentype") {
            newSrcs.push( await absolutePathToUrl(options, dest, fmt.fmt, true) )
          }
        }
        
      }
      newSrcs.push(mainSrcParts.join(", "))

    } else {

      //conversion / copy both failed, can't do anything but ignore
      fontAnalysis['action'] = 'ignore'
      newSrcs = oldSrcs
      
    }
  }

  //cleanup, remove temporary ttf src
  if(fontAnalysis['ttf_src_is_temporary']) {
    forceRemove(fontAnalysis['ttf_src_path'])
  }

  return newSrcs
}


async function updateFontRules(cssRoot, options, glyphs) {

  var fontRulesToProcess = [];

  cssRoot.walkAtRules(/font-face/i, function(rule) {
    fontRulesToProcess.push(rule)
  });

  debugLog("num rules =" + fontRulesToProcess.length)

  for(let frtpi=0; frtpi < fontRulesToProcess.length; frtpi++) {
    var rule = fontRulesToProcess[frtpi]; 

    var fontFamily = ""
    var fontFiles = {}
    var srcRootPath = pathTools.dirname(rule.source.input.file)
    var oldSrcs = []
    
    rule.walkDecls( (decl) => {
      if(decl.prop.match(/src/i)) {
        fontFiles = parseFontSrc(decl.value, srcRootPath, fontFiles)
        oldSrcs.push( decl.value)
        decl.remove()
      }
      if(decl.prop.match(/font-family/i)) {
        fontFamily = decl.value.replace(/^["']/, '').replace(/["']$/, '')
        debugLog("font-family: " + decl.value)
      }
    });

    debugLog(glyphs)
    //debugLog(fontFiles)

    
    debugLog(fontFiles)
    let fontAnalysis = await analyzeFont(options, glyphs, fontFiles, fontFamily);
    debugLog(fontAnalysis);    

    
    let newSrcs = await processFontAndGenerateSrcs(options, fontFiles, fontAnalysis, oldSrcs);
    
    debugLog("ADDING " + newSrcs.length )
    

    for(let nsi=0; nsi < newSrcs.length; nsi++) {
      rule.append({ prop: 'src', value: newSrcs[nsi], source: rule.source })
    }
    

  }

}


async function runPlugin(cssRoot, result, pluginOptions) {

  const postcssOpts = result.opts;
  const options = initOptions(pluginOptions, postcssOpts)

  mkdirp.sync(options['absolute_to'])
  let cssGlyphs = findGlyphs(cssRoot)
  let glyphs = extractContentGlyphs(options, cssGlyphs);

  await updateFontRules(cssRoot, options, glyphs)

}


module.exports = postcss.plugin('postcss-purgeglyphs', (pluginOptions) => {

  return function(cssRoot, result) {
    let promises = [];
    promises.push( runPlugin(cssRoot, result, pluginOptions) );
    return Promise.all(promises);
  };

});

