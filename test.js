const postcss = require('postcss')
const plugin = require('./lib')
const test = require('ava');
const fs = require('fs')
const mkdirp = require('mkdirp')
const pathTools = require('path')
const fonteditor = require('fonteditor-core')
const glob = require('glob')

var testRuns = {}


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
    console.log("FONTEDITOR-CORE ERROR LOADING CODE POINTS: " + err);
  }

  return codePoints.sort()
}



async function runTest (runId, from, opts = { }) {

  try {
  let toDir = "./test/output/" + runId
  testRuns[runId]['from'] = from
  testRuns[runId]['to'] = toDir + "/test.css"
  testRuns[runId]['error'] = null

  fs.rmdirSync(toDir, { recursive: true });
  mkdirp(toDir)

  let css = fs.readFileSync(from, {encoding: 'utf8'});
  let result = await postcss([plugin(opts)]).process(css, { from: from, to: testRuns[runId]['to'] })

  testRuns[runId]['result'] = result

  } catch(err) {
    testRuns[runId]['error'] = err
  }

  testRuns[runId]['done'] = true

}


async function getRun(name) {
  
  let runId = name
  let from = "test/test_assets/test-main.css"
  let opts = {}
  if(runId != 'default') {

    //define other run parameters here 
    if(runId == 'cb-query') {
      opts = { 'cache_busting' : 'query' }
    }
    if(runId == "url") {
      from = "test/test_assets/test-url.css"
      opts = { 'ignore_urls' : false }
    }
    if(runId == "url-faonly") {
      from = "test/test_assets/test-url.css"
      opts = { 'ignore_urls' : false, 'purge_only_fonts': ['Font Awesome 5 Free'] }
    }
    if(runId == "content") {
      from = "test/test_assets/test-content.css"
      opts = { 'content': [ {'scan_type': 'html_escaped', 'files':['test/test_assets/**.html']}, {'scan_type': 'unescaped', 'files':['test/test_assets/**.html']}   ] }
    }
    if(runId == "content-ignorefa-minmax") { 
      from = "test/test_assets/test-content.css"
      opts = { 'ignore_fonts': ['Font Awesome 5 Free'], 'preserve_glyphs': [ 'A', ("Z").codePointAt(0) ], 'content': [{'scan_type': 'unescaped', 'min':("a").codePointAt(0), 'max':("z").codePointAt(0), 'files':['test/test_assets/**.html']}   ] }
    }
  }


  if(testRuns[runId] == null) {
    
    testRuns[runId] = { id: runId, done: false }
    let runPromise = runTest(runId, from, opts);
    testRuns[runId]['promise'] = runPromise
  }

  while( !testRuns[runId]['done'] ) {
    await new Promise( (resolve, reject) => setTimeout(resolve, 500));
  }
  
  return testRuns[runId]


}



function getTypesPresent(basePath) {
   let types = ["eot", "woff2", "woff", "ttf", "svg" ]

   let present = []
   for(let ti=0; ti < types.length; ti++) {
     let filesOfType = glob.sync(basePath + "*" +  "." + types[ti])
     if(filesOfType.length > 0) {
       present.push( types[ti] )
     }
   }
   return present

}



function getSrcsForFont(fontFamily, weight, cssRoot) {
  
  let foundSrcs = []  
  cssRoot.walkAtRules(/font\-face/i, function(rule) {
    let nextFam = ""
    let nextWeight = ""
    let nextSrcs = []
    rule.walkDecls( (decl) => {
      if(decl.prop.match(/^font\-family$/i)) {
        nextFam = decl.value
      }
      if(decl.prop.match(/^font\-weight$/i)) {
        nextWeight = decl.value
      }
      if(decl.prop.match(/^src$/i)) {
        nextSrcs.push( decl.value)
      }
    });

   
    if( (nextFam == fontFamily || nextFam == "'" + fontFamily + "'" || nextFam == "\"" + fontFamily + "\"") && ( weight == null || nextWeight == weight || nextWeight == "'" + weight + "'" || nextWeight == "\"" + weight + "\"" )) {
      foundSrcs = nextSrcs
    }
  });

  return foundSrcs
}


function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}


function qbSrcsMatchExpected(fontFamily, weight, outputBasePath, cssRoot) {


  let srcs = getSrcsForFont(fontFamily, weight, cssRoot);

  //console.log(srcs)

  let baseOne = 'url("DESTBASE.eot?fonthash=HEXHASH")';
  let baseTwo = 'url("DESTBASE.eot?fonthash=HEXHASH") format("embedded-opentype"), url("DESTBASE.woff2?fonthash=HEXHASH") format("woff2"), url("DESTBASE.woff?fonthash=HEXHASH") format("woff"), url("DESTBASE.ttf?fonthash=HEXHASH") format("truetype"), url("DESTBASE.svg?fonthash=HEXHASH") format("svg")'


  let testRegexpOne = new RegExp( escapeRegex( baseOne.replace(/DESTBASE/g, outputBasePath)  ).replace(/HEXHASH/g, '[0-9a-f]{8}') )
  let testRegexpTwo = new RegExp( escapeRegex( baseTwo.replace(/DESTBASE/g, outputBasePath) ).replace(/HEXHASH/g, '[0-9a-f]{8}') )


  let firstMatches = srcs.length != 2 ? false : srcs[0].match(testRegexpOne);
  let secondMatches = srcs.length !=2 ? false : srcs[1].match(testRegexpTwo);

  //console.log (firstMatches);
  //console.log(secondMatches);


  return firstMatches != null && secondMatches != null

}

function fhSrcsMatchExpected(fontFamily, weight, outputBasePath, cssRoot) {


  let srcs = getSrcsForFont(fontFamily, weight, cssRoot);

  //console.log(srcs)

  let baseOne = 'url("DESTBASE-HEXHASH.eot")';
  let baseTwo = 'url("DESTBASE-HEXHASH.eot?#iefix") format("embedded-opentype"), url("DESTBASE-HEXHASH.woff2") format("woff2"), url("DESTBASE-HEXHASH.woff") format("woff"), url("DESTBASE-HEXHASH.ttf") format("truetype"), url("DESTBASE-HEXHASH.svg") format("svg")'


  let testRegexpOne = new RegExp( escapeRegex( baseOne.replace(/DESTBASE/g, outputBasePath)  ).replace(/HEXHASH/g, '[0-9a-f]{8}') )
  let testRegexpTwo = new RegExp( escapeRegex( baseTwo.replace(/DESTBASE/g, outputBasePath) ).replace(/HEXHASH/g, '[0-9a-f]{8}') )


  let firstMatches = srcs.length != 2 ? false : srcs[0].match(testRegexpOne);
  let secondMatches = srcs.length !=2 ? false : srcs[1].match(testRegexpTwo);



  return firstMatches != null && secondMatches != null

}




/*****************************************************************
 Default Run
*******************************************************/



test('Default Run Completed Without Error', async (t) => {

  let run = await getRun('default')
  t.is(run['error'], null)
  

});



test('Default Run Font Directory Exists', async (t) => {
  
  let run = await getRun('default')
  let dirExists =  fs.existsSync( pathTools.dirname(run['to']) + "/fonts" )
  t.is(dirExists, true)


});



test('Default Run Created all Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('default')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 5)


});


test('Default Run Created all Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('default')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 5)


});

test('Default Run Created all Font Types for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('default')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular" ) 
  t.is(found.length, 5)


});

test('Default Run Created all Font Types for NotoSansCJKsc-Bold font', async (t) => {
  
  let run = await getRun('default')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/NotoSansCJKsc-Bold" ) 
  t.is(found.length, 5)


});



test('Default Run Created only one glyph for fa-regular-400 font', async (t) => {
  
  let run = await getRun('default')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-regular-400*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 1)


});

test('Default Run Created three glyphs for fa-solid-900 font', async (t) => {
  
  let run = await getRun('default')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-solid-900*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 3)


});



test('Default Run Created all glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('default')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 663)


});

test('Default Run Created only one glyph for NotoSansCJKsc-Bold font', async (t) => {
  
  let run = await getRun('default')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/NotoSansCJKsc-Bold*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 1)


});


test('Default Run set CSS @font-family src rules properly for fa-regular-400 font', async (t) => {
  let run = await getRun('default')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '400', "fonts/fa-regular-400", cssRoot), true)

});




test('Default Run set CSS @font-family src rules properly for fa-solid-900 font', async (t) => {
  let run = await getRun('default')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '900', "fonts/fa-solid-900", cssRoot), true)

});




test('Default Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('default')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});




test('Default Run set CSS @font-family src rules properly for NotoSansCJKsc-Bold font', async (t) => {
  let run = await getRun('default')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('NotoSansCJKsc-Bold', null, "fonts/NotoSansCJKsc-Bold", cssRoot), true)

});



test('Default Run ignored, leaving unchanged, CSS @font-family src rules for Vaporware Type font which does not exist at path defined in css', async (t) => {
  let run = await getRun('default')
  let cssRoot = run['result']['root']
  

  let vaporwareSrcs = getSrcsForFont("Vaporware Type", null, cssRoot)

  let matchOne = vaporwareSrcs.length != 2 ? false : vaporwareSrcs[0] == 'url("test_font_dir/vaporware.eot")'
  let matchTwo = vaporwareSrcs.length != 2 ? false : vaporwareSrcs[1] == 'url("test_font_dir/vaporware.eot?#iefix") format("embedded-opentype"), url("test_font_dir/vaporware.woff2") format("woff2"), url("test_font_dir/vaporware.woff") format("woff"), url("test_font_dir/vaporware.ttf") format("truetype"), url("test_font_dir/vaporware.svg") format("svg")'

  t.is( matchOne && matchTwo, true)

});












/*****************************************************************
 Cache-Buster Query Run
*******************************************************/

test('Cache-Buster-Query Run Completed Without Error', async (t) => {

  let run = await getRun('cb-query')
  t.is(run['error'], null)
  

});



test('Cache-Buster-Query Run Font Directory Exists', async (t) => {
  
  let run = await getRun('cb-query')
  let dirExists =  fs.existsSync( pathTools.dirname(run['to']) + "/fonts" )
  t.is(dirExists, true)


});



test('Cache-Buster-Query Run Created all Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('cb-query')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 5)


});


test('Cache-Buster-Query Run Created all Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('cb-query')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 5)


});

test('Cache-Buster-Query Run Created all Font Types for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('cb-query')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular" ) 
  t.is(found.length, 5)


});

test('Cache-Buster-Query Run Created all Font Types for NotoSansCJKsc-Bold font', async (t) => {
  
  let run = await getRun('cb-query')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/NotoSansCJKsc-Bold" ) 
  t.is(found.length, 5)


});



test('Cache-Buster-Query Run Created only one glyph for fa-regular-400 font', async (t) => {
  
  let run = await getRun('cb-query')

  let codePoints = getTruetypeCodePoints( pathTools.dirname(run['to']) + "/fonts/fa-regular-400.ttf"   ) 
  t.is(codePoints.length, 1)


});

test('Cache-Buster-Query Run Created three glyphs for fa-solid-900 font', async (t) => {
  
  let run = await getRun('cb-query')

  let codePoints = getTruetypeCodePoints( pathTools.dirname(run['to']) + "/fonts/fa-solid-900.ttf"   ) 
  t.is(codePoints.length, 3)


});



test('Cache-Buster-Query Run Created all glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('cb-query')
  let codePoints = getTruetypeCodePoints( pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular.ttf"  ) 
  t.is(codePoints.length, 663)


});

test('Cache-Buster-Query Run Created only one glyph for NotoSansCJKsc-Bold font', async (t) => {
  
  let run = await getRun('cb-query')



  let codePoints = getTruetypeCodePoints( pathTools.dirname(run['to']) + "/fonts/NotoSansCJKsc-Bold.ttf"   ) 
  t.is(codePoints.length, 1)


});


test('Cache-Buster-Query Run set CSS @font-family src rules properly for fa-regular-400 font', async (t) => {
  let run = await getRun('cb-query')
  let cssRoot = run['result']['root']
  
  t.is( qbSrcsMatchExpected('Font Awesome 5 Free', '400', "fonts/fa-regular-400", cssRoot), true)

});




test('Cache-Buster-Query Run set CSS @font-family src rules properly for fa-solid-900 font', async (t) => {
  let run = await getRun('cb-query')
  let cssRoot = run['result']['root']
  
  t.is( qbSrcsMatchExpected('Font Awesome 5 Free', '900', "fonts/fa-solid-900", cssRoot), true)

});




test('Cache-Buster-Query Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('cb-query')
  let cssRoot = run['result']['root']
  
  t.is( qbSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});




test('Cache-Buster-Query Run set CSS @font-family src rules properly for NotoSansCJKsc-Bold font', async (t) => {
  let run = await getRun('cb-query')
  let cssRoot = run['result']['root']
  
  t.is( qbSrcsMatchExpected('NotoSansCJKsc-Bold', null, "fonts/NotoSansCJKsc-Bold", cssRoot), true)

});



test('Cache-Buster-Query Run ignored, leaving unchanged, CSS @font-family src rules for Vaporware Type font which does not exist at path defined in css', async (t) => {
  let run = await getRun('cb-query')
  let cssRoot = run['result']['root']
  

  let vaporwareSrcs = getSrcsForFont("Vaporware Type", null, cssRoot)

  let matchOne = vaporwareSrcs.length != 2 ? false : vaporwareSrcs[0] == 'url("test_font_dir/vaporware.eot")'
  let matchTwo = vaporwareSrcs.length != 2 ? false : vaporwareSrcs[1] == 'url("test_font_dir/vaporware.eot?#iefix") format("embedded-opentype"), url("test_font_dir/vaporware.woff2") format("woff2"), url("test_font_dir/vaporware.woff") format("woff"), url("test_font_dir/vaporware.ttf") format("truetype"), url("test_font_dir/vaporware.svg") format("svg")'

  t.is( matchOne && matchTwo, true)

});

/*******************************
URL Download Run
******************************/


test('URL Download Run Completed Without Error', async (t) => {

  let run = await getRun('url')
  t.is(run['error'], null)
  

});


test('URL Download Run Created all Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('url')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 5)


});


test('URL Download Run Created all Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('url')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 5)


});



test('URL Download Run Created only one glyph for fa-regular-400 font', async (t) => {
  
  let run = await getRun('url')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-regular-400*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 1)


});

test('URL Download Run Created three glyphs for fa-solid-900 font', async (t) => {
  
  let run = await getRun('url')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-solid-900*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 3)


});

test('URL Download Run Created 26 glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('url')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 26)


});

test('URL Download Run set CSS @font-family src rules properly for fa-regular-400 font', async (t) => {
  let run = await getRun('url')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '400', "fonts/fa-regular-400", cssRoot), true)

});




test('URL Download Run set CSS @font-family src rules properly for fa-solid-900 font', async (t) => {
  let run = await getRun('url')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '900', "fonts/fa-solid-900", cssRoot), true)

});




test('URL Download Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('url')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});


/*******************************
FontAwesome Only Run
******************************/


test('FontAwesome Only Run Completed Without Error', async (t) => {

  let run = await getRun('url-faonly')
  t.is(run['error'], null)
  

});


test('FontAwesome Only Run Created all Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('url-faonly')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 5)


});


test('FontAwesome Only Run Created all Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('url-faonly')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 5)


});



test('FontAwesome Only Run Created only one glyph for fa-regular-400 font', async (t) => {
  
  let run = await getRun('url-faonly')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-regular-400*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 1)


});

test('FontAwesome Only Run Created three glyphs for fa-solid-900 font', async (t) => {
  
  let run = await getRun('url-faonly')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-solid-900*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 3)


});

test('FontAwesome Only Run Created All glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('url-faonly')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 663)


});

test('FontAwesome Only Run set CSS @font-family src rules properly for fa-regular-400 font', async (t) => {
  let run = await getRun('url-faonly')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '400', "fonts/fa-regular-400", cssRoot), true)

});




test('FontAwesome Only Run set CSS @font-family src rules properly for fa-solid-900 font', async (t) => {
  let run = await getRun('url-faonly')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '900', "fonts/fa-solid-900", cssRoot), true)

});




test('FontAwesome Only Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('url-faonly')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});



/*******************************
Content  Run
******************************/


test('Content  Run Completed Without Error', async (t) => {

  let run = await getRun('content')
  t.is(run['error'], null)
  

});


test('Content  Run Created all Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('content')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 5)


});


test('Content  Run Created all Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('content')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 5)


});



test('Content  Run Created only one glyph for fa-regular-400 font', async (t) => {
  
  let run = await getRun('content')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-regular-400*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf ) 
  t.is(codePoints.length, 1)


});

test('Content  Run Created three glyphs for fa-solid-900 font', async (t) => {
  
  let run = await getRun('content')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/fa-solid-900*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf )
  t.is(codePoints.length, 3)


});

test('Content  Run Created only 42 glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('content')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 42)


});

test('Content  Run set CSS @font-family src rules properly for fa-regular-400 font', async (t) => {
  let run = await getRun('content')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '400', "fonts/fa-regular-400", cssRoot), true)

});


test('Content  Run set CSS @font-family src rules properly for fa-solid-900 font', async (t) => {
  let run = await getRun('content')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Font Awesome 5 Free', '900', "fonts/fa-solid-900", cssRoot), true)

});


test('Content  Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('content')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});




/*******************************
Content  MinMax Ingore FA Run
******************************/


test('Content MinMax Ignore Fontawesome Run Completed Without Error', async (t) => {

  let run = await getRun('content-ignorefa-minmax')
  t.is(run['error'], null)

});


test('Content MinMax Ignore Fontawesome Run Created no Font Types for fa-regular-400 font', async (t) => {
  
  let run = await getRun('content-ignorefa-minmax')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-regular-400" ) 
  t.is(found.length, 0)


});
test('Content MinMax Ignore Fontawesome Run Created no Font Types for fa-solid-900 font', async (t) => {
  
  let run = await getRun('content-ignorefa-minmax')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/fa-solid-900" ) 
  t.is(found.length, 0)


});

test('Content MinMax Ignore Fontawesome  Run Created all Font Types for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('content-ignorefa-minmax')

  let found = getTypesPresent(  pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular" ) 
  t.is(found.length, 5)


});


test('Content MinMax Ignore Fontawesome Run Created only 28 glyphs for LiberationMono-Regular font', async (t) => {
  
  let run = await getRun('content-ignorefa-minmax')
  let ttf = glob.sync(pathTools.dirname(run['to']) + "/fonts/LiberationMono-Regular*.ttf").shift()  
  let codePoints = getTruetypeCodePoints( ttf  ) 
  t.is(codePoints.length, 28)


});

test('Content MinMax Ignore Fontawesome Run set CSS @font-family src rules properly for LiberationMono-Regular font', async (t) => {
  let run = await getRun('content-ignorefa-minmax')
  let cssRoot = run['result']['root']
  
  t.is( fhSrcsMatchExpected('Liberation Mono', null, "fonts/LiberationMono-Regular", cssRoot), true)

});



