// Copyright (C) 2009 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Make this frame SES-safe or die trying.
 *
 * <p>Should be called before any other potentially dangerous script
 * is executed in this frame. If it succeeds, the new global bindings
 * for <tt>eval</tt> and <tt>Function</tt> in this frame will only
 * load code according to the <i>loader isolation</i> rules of the
 * object-capability model. If all other code executed directly in
 * this frame (i.e., other than through these <tt>eval</tt> and
 * <tt>Function</tt> bindings) takes care to uphold object-capability
 * rules, then untrusted code loaded via <tt>eval</tt> and
 * <tt>Function</tt> will be constrained by those rules.
 *
 * <p>On a pre-ES5 browser, this script will fail cleanly, leaving the
 * frame intact. Otherwise, if this script fails, it may leave this
 * frame in an unusable state. All following description assumes this
 * script succeeds and that the browser conforms to the ES5 spec. The
 * ES5 spec allows browsers to implement more than is specified as
 * long as certain invariants are maintained. We further assume that
 * these extensions are not maliciously designed to obey the letter of
 * these invariants while subverting the intent of the spec. In other
 * words, even on an ES5 conformant browser, we do not presume to
 * defend ourselves from a browser that is out to get us.
 *
 * @param global ::Record(any) Assumed to be the real global object for
 *        this frame. Since startSES will allow global variable
 *        references that appear at the top level of the whitelist,
 *        our safety depends on these variables being frozen as a side
 *        effect of freezing the corresponding properties of
 *        <tt>global</tt>. These properties are also duplicated onto a
 *        <i>root accessible primordial</i>, which is provided as the
 *        <tt>this</tt> binding for hermetic eval calls -- emulating
 *        the safe subset of the normal global object.
 * @param whitelist ::Record(Permit)
 *            where Permit = true | "*" | "skip" | Record(Permit).
 *        Describes the subset of naming paths starting from the root
 *        that should be accessible. The <i>accessible primordials</i>
 *        are this root plus all values found by navigating these paths
 *        starting from this root. All non-whitelisted properties of
 *        accessible primordials are deleted, and then all accessible
 *        primordials are frozen with the whitelisted properties
 *        frozen as data properties.
 * @param atLeastFreeVarNames ::F([string], Record(true))
 *        Given the sourceText for a strict Program,
 *        atLeastFreeVarNames(sourceText) returns a Record whose
 *        enumerable own property names must include the names of all the
 *        free variables occuring in sourceText. It can include as
 *        many other strings as is convenient so long as it includes
 *        these. The value of each of these properties should be
 *        {@code true}.
 * @param debugging ::Boolean
 *        Do what we have to, to enable the browser debugger to still work.
 *        At present, this causes {@code eval} to no longer be safe. Obviously
 *        this must not be set in production code!
 */
function startSES(global, whitelist, atLeastFreeVarNames, debugging) {
//  "use strict"; // not here because of an unreported Caja bug

  /////////////// KLUDGE SWITCHES ///////////////

  /////////////////////////////////
  // The following are only the minimal kludges needed for the current
  // Mozilla Minefield (Firefox Beta) or Chrome Beta. At the time of
  // this writing, these are Mozilla 4.0b13pre (2011-03-02) and Chrome
  // 11.0.686.1 dev. As these move forward, kludges can be removed
  // until we simply rely on ES5.

  /**
   * This switch simply reflects that not all almost-ES5 browsers yet
   * implement strict mode.
   */
  //var REQUIRE_STRICT = true;
  var REQUIRE_STRICT = false;

  /**
   * This switch represents some non-isolated, and thus, not yet
   * reported bug on Chrome/v8 only, that results in
   * "Uncaught TypeError: Cannot redefine property: defineProperty"
   * TODO(erights): isolate and report this.
   */
  //var FREEZE_EARLY = undefined;
  var FREEZE_EARLY = Array.prototype.forEach;

  /**
   * This switch represents what looks like another manifestation of
   * the same undiagnosed bug as that motivating FREEZE_EARLY. The
   * symptom is again
   * "TypeError: Cannot redefine property: defineProperty"
   * with a similar stack.
   */
  //var TOLERATE_FAILED_FREEZE = false;
  var TOLERATE_FAILED_FREEZE = true;

  /**
   * Workaround for <a href=
   * "https://bugs.webkit.org/show_bug.cgi?id=55537"
   * >https://bugs.webkit.org/show_bug.cgi?id=55537</a>.
   */
  //var TOLERATE_MISSING_DESCRIPTOR = false;
  var TOLERATE_MISSING_DESCRIPTOR = true;

  //////////////// END KLUDGE SWITCHES ///////////

  var dirty = true;

  function fail(str) {
    debugger;
    throw new EvalError(str);
  }

  if (typeof WeakMap === 'undefined') {
    fail('No built-on WeakMaps, so WeakMap.js must be loaded first');
  }

  if (REQUIRE_STRICT && function(){return this;}()) {
    fail('Requires at least ES5 support');
  }

  /**
   * Code being eval'ed sees <tt>root</tt> as its <tt>this</tt>, as if
   * <tt>root</tt> were the global object.
   *
   * <p>Root's properties are exactly the whitelistes global variable
   * references. These properties, both as they appear on the global
   * object and on this root object, are frozen and so cannot
   * diverge. This preserves the illusion.
   */
  var root = Object.create(null);

  /** Repair phase -- monkey patch safe replacements */
  (function() {

    /**
     * The unsafe* variables hold precious values that must not escape
     * to untrusted code. When {@code eval} is invoked via {@code
     * unsafeEval}, this is a call to the indirect eval function, not
     * the direct eval operator.
     */
    var unsafeEval = eval;
    var UnsafeFunction = Function;

    /**
     * Fails if {@code programSrc} does not parse as a strict Program
     * production.
     *
     * <p>Uses Ankur Taly's trick to cheaply check that a program
     * parses using the platform's parser, as implicitly accessed by
     * the original eval function, while nevertheless ensuring that no
     * code from {@code programSrc} executes in the process.
     *
     * <p>TODO(erights): Switch to Crock's alternate suggestion of
     * calling UnsafeFunction instead, since it will report early
     * errors but will not execute regardless.
     */
    function verifyStrictProgram(programSrc) {
      try {
        unsafeEval('"use strict"; ' +
                   'throw "NotASyntaxError"; ' +
                   programSrc);
      } catch (ex) {
        if (ex !== 'NotASyntaxError') {
          throw ex;
        }
      }
    }

    /**
     * Fails if {@code exprSource} does not parse as a strict
     * Expression production.
     */
    function verifyStrictExpression(exprSrc) {
      verifyStrictProgram(exprSrc + ';');
      verifyStrictProgram('( ' + exprSrc + '\n);');
    }

    /**
     * For all the enumerable own properties of {@code from}, copy
     * their descriptors to {@code virtualGlobal}, except that the
     * property added to {@code virtualGlobal} is unconditionally
     * non-enumerable and (for the moment) configurable.
     *
     * <p>By copying descriptors rather than values, any accessor
     * properties of {@code env} becomes an accessors of {code
     * virtualGlobal} with the same getter and setter. If these do not
     * use their {@code this} value, then the original any copied
     * properties are effectively joined.
     *
     * <p>We make these configurable so that {@code virtualGlobal} can
     * be further configured before being frozen. We make these
     * non-enumerable in order to emulate the normal behavior of
     * built-in properties of typical global objects, such as the
     * browser's {@code window} object.
     */
    function initGlobalProperties(from, virtualGlobal) {
      var names = Object.getOwnPropertyNames(from);
      for (var i in names) {
        var name = names[i];
        var desc = Object.getOwnPropertyDescriptor(from, name);
        if (desc) {
          desc.enumerable = false;
          desc.configurable = true;
          Object.defineProperty(virtualGlobal, name, desc);
        }
      }
    }

    /**
     * Make a frozen virtual global object whose properties are the
     * union of the whitelisted globals and the enumerable own
     * properties of {@code env}.
     *
     * <p>If there is a collision, the property from {@code env}
     * shadows the whitelisted global. We shadow by overwriting rather
     * than inheritance so that shadowing makes the original binding
     * inaccessible.
     *
     * <p>TODO(erights): Revisit whether the elements of {@code env}
     * should be made to appear as properties on the virtual global
     * binding of "this", rather than simply being in virtual global
     * scope. Each decision violates some assumptions.
     */
    function makeVirtualGlobal(env) {
      var virtualGlobal = Object.create(null);
      initGlobalProperties(root, virtualGlobal);
      initGlobalProperties(env, virtualGlobal);
      return Object.freeze(virtualGlobal);
    }

    /**
     * Make a frozen scope object which inherits from
     * {@code virtualGlobal}, for use by {@code with} to prevent
     * access to any {@code freeNames} other than those found on the.
     * {@code virtualGlobal}.
     */
    function makeScopeObject(virtualGlobal, freeNames) {
      var scopeObject = Object.create(virtualGlobal);
      for (var name in freeNames) {
        if (!(name in virtualGlobal)) {
          (function(name) {
            Object.defineProperty(scopeObject, name, {
              get: function() {
                throw new ReferenceError('"' + name + '" not in scope');
              },
              set: function(ignored) {
                throw new TypeError('Can\'t set "' + name + '"');
              },
              enumerable: true
            });
          })(name);
        }
      }
      return Object.freeze(scopeObject);
    }


    /**
     * Compile {@code exprSrc} as a strict expression into a function
     * of an environment {@code env}, that when called evaluates
     * {@code exprSrc} in a virtual global environment consisting only
     * of the whitelisted globals and a snapshot of the enumerable own
     * properties of {@code env}.
     *
     * <p>When SES {@code compile} is provided primitively, it should
     * accept a Program and return a function that evaluates it to the
     * Program's completion value. Unfortunately, this is not
     * practical as a library without some non-standard support from
     * the platform such as an parser API that provides an AST.
     *
     * <p>Thanks to Mike Samuel and Ankur Taly for this trick of using
     * {@code with} together with RegExp matching to intercept free
     * variable access without parsing.
     *
     * <p>TODO(erights): Switch to Erik Corry's suggestion that we
     * bring each of these variables into scope by generating a
     * shadowing declaration, rather than using "with".
     *
     * <p>TODO(erights): Find out if any platforms have any way to
     * associate a file name and line number with eval'ed text, and
     * arrange to pass these through compile and all its relevant
     * callers.
     */
    function compile(exprSrc) {
      if (dirty) { fail('Initial cleaning failed'); }
      verifyStrictExpression(exprSrc);
      var freeNames = atLeastFreeVarNames(exprSrc);
      var wrapperSrc =
        '(function() { ' +
        // non-strict code, where this === scopeObject
        '  with (this) { ' +
        '    return function() { ' +
        '      "use strict"; ' +
        '      return ( ' +
        // strict code, where this === virtualGlobal
        '        ' + exprSrc + '\n' +
        '      );\n' +
        '    };\n' +
        '  }\n' +
        '})';
      var wrapper = unsafeEval(wrapperSrc);
      return function(env) {
        var virtualGlobal = makeVirtualGlobal(env);
        var scopeObject = makeScopeObject(virtualGlobal, freeNames);
        return wrapper.call(scopeObject).call(virtualGlobal);
      };
    }

    var directivePattern = (/^['"](?:\w|\s)*['"]$/m);

    var requirePattern = (/^(?:\w*\s*(?:\w|\$|\.)*\s*=\s*)?\s*require\s*\(\s*['"]((?:\w|\$|\.|\/)+)['"]\s*\)$/m);

    /**
     * As an experiment, recognize a stereotyped prelude of the
     * CommonJS module system.
     */
    function getRequirements(modSrc) {
      var result = [];
      var stmts = modSrc.split(';');
      var stmt;
      var i = 0, ilen = stmts.length;
      for (; i < ilen; i++) {
        stmt = stmts[i].trim();
        if (stmt !== '') {
          if (!directivePattern.test(stmt)) { break; }
        }
      }
      for (; i < ilen; i++) {
        stmt = stmts[i].trim();
        if (stmt !== '') {
          var m = requirePattern.exec(stmt);
          if (!m) { break; }
          result.push(m[1]);
        }
      }
      return Object.freeze(result);
    }

    /**
     * A module source is actually any valid FunctionBody, and thus any valid
     * Program.
     *
     * <p>In addition, in case the module source happens to begin with
     * a streotyped prelude of the CommonJS module system, the
     * function resulting from module compilation has an additional
     * {@code "requirements"} property whose value is a list of the
     * module names being required by that prelude. These requirements
     * are the module's "immediate synchronous dependencies".
     *
     * <p>This {@code "requirements"} property is adequate to
     * bootstrap support for a CommonJS module system, since a loader
     * can first load and compile the transitive closure of an initial
     * module's synchronous depencies before actually executing any of
     * these module functions.
     *
     * <p>With a similarly lightweight RegExp, we should be able to
     * similarly recognize the {@code "load"} syntax of <a href=
     * "http://wiki.ecmascript.org/doku.php?id=strawman:simple_modules#syntax"
     * >Sam and Dave's module proposal for ES-Harmony</a>. However,
     * since browsers do not currently accept this syntax,
     * {@code getRequirements} above would also have to extract these
     * from the text to be compiled.
     */
    function compileModule(modSrc) {
      var moduleMaker = compile('(function() {' + modSrc + '}).call(this)');
      moduleMaker.requirements = getRequirements(modSrc);
      Object.freeze(moduleMaker.prototype);
      return Object.freeze(moduleMaker);
    }

    /**
     * A safe form of the {@code Function} constructor, which
     * constructs strict functions that can only refer freely to the
     * whitelisted globals.
     *
     * <p>The returned function is strict whether or not it declares
     * itself to be.
     */
    function FakeFunction(var_args) {
      var params = [].slice.call(arguments, 0);
      var body = params.pop();
      body = String(body || '');
      params = params.join(',');
      var exprSrc = '(function(' + params + '\n){' + body + '})';
      return compile(exprSrc)({});
    }
    FakeFunction.prototype = UnsafeFunction.prototype;
    FakeFunction.prototype.constructor = FakeFunction;
    global.Function = FakeFunction;

    /**
     * A safe form of the indirect {@code eval} function, which
     * evaluates {@code src} as strict code that can only refer freely
     * to the whitelisted globals.
     *
     * <p>Given our parserless methods of verifying untrusted sources,
     * we unfortunately have no practical way to obtain the completion
     * value of a safely evaluated Program. Instead, we adopt a
     * compromise based on the following observation. All Expressions
     * are valid Programs, and all Programs are valid
     * FunctionBodys. If {@code src} parses as a strict expression,
     * then we evaluate it as an expression it and correctly return its
     * completion value, since that is simply the value of the
     * expression.
     *
     * <p>Otherwise, we evaluate {@code src} as a FunctionBody and
     * return what that would return from its implicit enclosing
     * function. If {@code src} is simply a Program, then it would not
     * have an explicit {@code return} statement, and so we fail to
     * return its completion value. This is sufficient for using
     * {@code eval} to emulate script tags, since script tags also
     * lose the completion value.
     *
     * <p>When SES {@code eval} is provided primitively, it should
     * accept a Program and evaluate it to the Program's completion
     * value. Unfortunately, this is not practical as a library
     * without some non-standard support from the platform such as an
     * parser API that provides an AST.
     */
    function fakeEval(src) {
      try {
        verifyStrictExpression(src);
      } catch (x) {
        src = '(function() {' + src + '\n}).call(this)';
      }
      return compile(src)({});
    }
    global.eval = fakeEval;

    var defended = WeakMap();
    /**
     * To define a defended object is to freeze it and all objects
     * transitively reachable from it via transitive reflective
     * property and prototype traversal.
     */
    function def(root) {
      var defending = WeakMap();
      var defendingList = [];
      function recur(val) {
        if (val !== Object(val) || defended.get(val) || defending.get(val)) {
          return;
        }
        defending.set(val, true);
        defendingList.push(val);
        Object.freeze(val);
        recur(Object.getPrototypeOf(val));
        Object.getOwnPropertyNames(val).forEach(function(p) {
          if (typeof val === 'function' &&
              (p === 'caller' || p === 'arguments')) {
            return;
          }
          var desc = Object.getOwnPropertyDescriptor(val, p);
          if (!desc) {
            if (TOLERATE_MISSING_DESCRIPTOR) { return; }
            fail('missing descriptor: ' + p);
          }
          try {
            recur(desc.value);
            recur(desc.get);
            recur(desc.set);
          } catch (err) {
            if (TOLERATE_FAILED_FREEZE && err instanceof TypeError) {
              cajaVM.log('still diagnosing(' + p + '): ' + err);
            } else {
              throw err;
            }
          }
        });
      }
      recur(root);
      defendingList.forEach(function(obj) {
        defended.set(obj, true);
      });
      return root;
    }

    global.cajaVM = {
      log: function(str) {
        if (typeof console !== 'undefined' &&
            typeof console.log === 'function') {
          console.log(str);
        }
      },
      compile: compile,
      compileModule: compileModule,
      def: def
    };

    if (debugging) {
      global.eval = unsafeEval;
      global.cajaVM.log("UNSAFE MODE: the unsafe version of eval has been left"+
        " in the global environment so that the the debugger can function");
    }

  })();

  var cantNeuter = [];

  /**
   * Read the current value of base[name], and freeze that property as
   * a data property to ensure that all further reads of that same
   * property from that base produce the same value.
   *
   * <p>The frozen property should preserve the enumerability of the
   * original property.
   */
  function read(base, name) {
    var desc = Object.getOwnPropertyDescriptor(base, name);
    if (desc && 'value' in desc && !desc.writable && !desc.configurable) {
      return desc.value;
    }

    var result = base[name];
    try {
      Object.defineProperty(base, name, {
        value: result, writable: false, configurable: false
      });
    } catch (ex) {
      cantNeuter.push({base: base, name: name, err: ex});
    }
    return result;
  }

  /** Initialize accessible global variables and root */
  Object.keys(whitelist).forEach(function(name) {
    var desc = Object.getOwnPropertyDescriptor(global, name);
    if (desc) {
      var permit = whitelist[name];
      if (permit) {
        var value = read(global, name);
        Object.defineProperty(root, name, {
          value: value,
          writable: false,
          enumerable: desc.enumerable,
          configurable: false
        });
      }
    }
  });

  /**
   * The whiteTable should map from each path-accessible primordial
   * object to the permit object that describes how it should be
   * cleaned.
   *
   * <p>To ensure that each subsequent traverse obtains the same
   * values, these paths become paths of frozen data properties.
   */
  var whiteTable = WeakMap();
  function register(value, permit) {
    if (value !== Object(value)) { return; }
    if (typeof permit !== 'object') {
      return;
    }
    var oldPermit = whiteTable.get(value);
    if (oldPermit) {
      debugger;
      return;
    }
    whiteTable.set(value, permit);
    Object.keys(permit).forEach(function(name) {
      if (permit[name] !== 'skip') {
        var sub = read(value, name);
        register(sub, permit[name]);
      }
    });
  }
  register(root, whitelist);

  /**
   * We initialize the whiteTable only so that we can process "*" and
   * "skip" inheritance in the whitelist, by walking actual superclass
   * chains.
   */
  function isPermitted(base, name) {
    var permit = whiteTable.get(base);
    if (permit) {
      if (permit[name]) { return permit[name]; }
    }
    while (true) {
      base = Object.getPrototypeOf(base);
      if (base === null) { return false; }
      permit = whiteTable.get(base);
      if (permit && name in permit) {
        var result = permit[name];
        if (result === '*' || result === 'skip') {
          return result;
        } else {
          return false;
        }
      }
    }
  }

  var cleaning = WeakMap();

  var skipped = [];
  var goodDeletions = [];
  var badDeletions = [];

  /**
   * Assumes all super objects are otherwise accessible and so will be
   * independently cleaned.
   */
  function clean(value, n) {
    if (value !== Object(value)) { return; }
    if (cleaning.get(value)) { return; }
    cleaning.set(value, true);
    Object.getOwnPropertyNames(value).forEach(function(name) {
      var path = n + (n ? '.' : '') + name;
      var p = isPermitted(value, name);
      if (p) {
        if (p === 'skip') {
          skipped.push(path);
        } else {
          var sub = read(value, name);
          clean(sub, path);
        }
      } else {
        // Strict delete throws on failure, which we can't count on yet
        var success;
        try {
          success = delete value[name];
        } catch (x) {
          debugger;
          success = false;
        }
        if (success) {
          goodDeletions.push(path);
        } else {
          debugger;
          badDeletions.push(path);
        }
      }
    });
    if (value !== FREEZE_EARLY) {
      Object.freeze(value);
    }
  }
  if (FREEZE_EARLY) { Object.freeze(FREEZE_EARLY); }
  clean(root, '');

  function reportDiagnosis(desc, problemList) {
    if (problemList.length === 0) { return false; }
    cajaVM.log(desc + ': ' + problemList.sort().join(' '));
    return true;
  }

  //reportDiagnosis('Skipped', skipped);
  reportDiagnosis('Deleted', goodDeletions);

  if (cantNeuter.length >= 1) {
    var complaint = cantNeuter.map(function(p) {
      var desc = Object.getPropertyDescriptor(p.base, p.name);
      if (!desc) {
        return '  Missing ' + p.name;
      }
      return p.name + '(' + p.err + '): ' +
        Object.getOwnPropertyNames(desc).map(function(attrName) {
          var v = desc[attrName];
          if (v === Object(v)) { v = 'a ' + typeof v; }
          return attrName + ': ' + v;
        }).join(', ');

    });
    reportDiagnosis("Can't neuter", complaint);
  }

  if (!reportDiagnosis("Can't delete", badDeletions)) {
    // We succeeded. Enable safe Function, eval, and compile to work.
    cajaVM.log("success");
    dirty = false;
  }
}
