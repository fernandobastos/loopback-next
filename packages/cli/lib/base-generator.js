// Copyright IBM Corp. 2017,2018. All Rights Reserved.
// Node module: @loopback/cli
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const Generator = require('yeoman-generator');
const chalk = require('chalk');
const utils = require('./utils');
const StatusConflicter = utils.StatusConflicter;
const path = require('path');
const readline = require('readline');
const debug = require('./debug')('base-generator');

/**
 * Base Generator for LoopBack 4
 */
module.exports = class BaseGenerator extends Generator {
  // Note: arguments and options should be defined in the constructor.
  constructor(args, opts) {
    super(args, opts);
    this.conflicter = new StatusConflicter(
      this.env.adapter,
      this.options.force,
    );
    this._setupGenerator();
  }

  /**
   * Subclasses can extend _setupGenerator() to set up the generator
   */
  _setupGenerator() {
    this.option('config', {
      type: String,
      alias: 'c',
      description: 'JSON file to configure options',
    });

    this.option('yes', {
      type: Boolean,
      alias: 'y',
      description:
        'Skip all confirmation prompts with default or provided value',
    });

    this.artifactInfo = this.artifactInfo || {
      rootDir: 'src',
    };
  }

  /**
   * Read a json document from stdin
   */
  _readJSONFromStdin() {
    const rl = readline.createInterface({
      input: process.stdin,
    });

    const lines = [];
    if (process.stdin.isTTY) {
      this.log(
        chalk.green(
          'Please type in a json object line by line ' +
            '(Press <ctrl>-D or type EOF to end):',
        ),
      );
    }

    let err;
    return new Promise((resolve, reject) => {
      rl.on('SIGINT', () => {
        err = new Error('Canceled by user');
        rl.close();
        reject(err);
      })
        .on('line', line => {
          if (line === 'EOF') {
            rl.close();
          } else {
            lines.push(line);
          }
        })
        .on('close', () => {
          if (err) return;
          const jsonStr = lines.join('\n');
          try {
            const json = JSON.parse(jsonStr);
            resolve(json);
          } catch (e) {
            if (!process.stdin.isTTY) {
              debug(e, jsonStr);
            }
            reject(e);
          }
        })
        .on('error', e => {
          err = e;
          rl.close();
          reject(err);
        });
    });
  }

  async setOptions() {
    let opts = {};
    const jsonFile = this.options.config;
    try {
      if (jsonFile === 'stdin' || !process.stdin.isTTY) {
        this.options['yes'] = true;
        opts = await this._readJSONFromStdin();
      } else if (typeof jsonFile === 'string') {
        opts = this.fs.readJSON(path.resolve(process.cwd(), jsonFile));
      }
    } catch (e) {
      this.exit(e);
      return;
    }
    if (!(typeof opts === 'object')) {
      this.exit('Invalid config file: ' + jsonFile);
      return;
    }
    for (const o in opts) {
      if (this.options[o] == null) {
        this.options[o] = opts[o];
      }
    }
  }

  /**
   * Check if a question can be skipped in `express` mode
   * @param {object} question A yeoman prompt
   */
  _isQuestionOptional(question) {
    return (
      question.default != null || // Having a default value
      this.options[question.name] != null || // Configured in options
      question.type === 'list' || // A list
      question.type === 'rawList' || // A raw list
      question.type === 'checkbox' || // A checkbox
      question.type === 'confirm'
    ); // A confirmation
  }

  /**
   * Get the default answer for a question
   * @param {*} question
   */
  async _getDefaultAnswer(question, answers) {
    let def = question.default;
    if (typeof question.default === 'function') {
      def = await question.default(answers);
    }
    let defaultVal = def;

    if (def == null) {
      // No `default` is set for the question, check existing answers
      defaultVal = answers[question.name];
      if (defaultVal != null) return defaultVal;
    }

    if (question.type === 'confirm') {
      return defaultVal != null ? defaultVal : true;
    }
    if (question.type === 'list' || question.type === 'rawList') {
      // Default to 1st item
      if (def == null) def = 0;
      if (typeof def === 'number') {
        // The `default` is an index
        const choice = question.choices[def];
        if (choice) {
          defaultVal = choice.value || choice.name;
        }
      } else {
        // The default is a value
        if (question.choices.map(c => c.value || c.name).includes(def)) {
          defaultVal = def;
        }
      }
    } else if (question.type === 'checkbox') {
      if (def == null) {
        defaultVal = question.choices
          .filter(c => c.checked && !c.disabled)
          .map(c => c.value || c.name);
      } else {
        defaultVal = def
          .map(d => {
            if (typeof d === 'number') {
              const choice = question.choices[d];
              if (choice && !choice.disabled) {
                return choice.value || choice.name;
              }
            } else {
              if (
                question.choices.find(
                  c => !c.disabled && d === (c.value || c.name),
                )
              ) {
                return d;
              }
            }
            return undefined;
          })
          .filter(v => v != null);
      }
    }
    return defaultVal;
  }

  /**
   * Override the base prompt to skip prompts with default answers
   * @param questions One or more questions
   */
  async prompt(questions) {
    // Normalize the questions to be an array
    if (!Array.isArray(questions)) {
      questions = [questions];
    }
    if (!this.options['yes']) {
      if (!process.stdin.isTTY) {
        this.log(
          chalk.red('The stdin is not a terminal. No prompt is allowed.'),
        );
        process.exit(1);
      }
      // Non-express mode, continue to prompt
      return await super.prompt(questions);
    }

    const answers = Object.assign({}, this.options);

    for (const q of questions) {
      let when = q.when;
      if (typeof when === 'function') {
        when = await q.when(answers);
      }
      if (when === false) continue;
      if (this._isQuestionOptional(q)) {
        const answer = await this._getDefaultAnswer(q, answers);
        debug('%s: %j', q.name, answer);
        answers[q.name] = answer;
      } else {
        if (!process.stdin.isTTY) {
          this.log(
            chalk.red('The stdin is not a terminal. No prompt is allowed.'),
          );
          process.exit(1);
        }
        // Only prompt for non-skipped questions
        const props = await super.prompt([q]);
        Object.assign(answers, props);
      }
    }
    return answers;
  }

  /**
   * Override the usage text by replacing `yo loopback4:` with `lb4 `.
   */
  usage() {
    const text = super.usage();
    return text.replace(/^yo loopback4:/g, 'lb4 ');
  }

  /**
   * Tell this generator to exit with the given reason
   * @param {string|Error} reason
   */
  exit(reason) {
    // exit(false) should not exit
    if (reason === false) return;
    // exit(), exit(undefined), exit('') should exit
    if (!reason) reason = true;
    this.exitGeneration = reason;
  }

  /**
   * Checks if current directory is a LoopBack project by checking for
   * keyword 'loopback' under 'keywords' attribute in package.json.
   * 'keywords' is an array
   */
  checkLoopBackProject() {
    debug('Checking for loopback project');
    if (this.shouldExit()) return false;
    const pkg = this.fs.readJSON(this.destinationPath('package.json'));
    const key = 'loopback';
    if (!pkg) {
      const err = new Error(
        'No package.json found in ' +
          this.destinationRoot() +
          '. ' +
          'The command must be run in a LoopBack project.',
      );
      this.exit(err);
      return;
    }
    if (!pkg.keywords || !pkg.keywords.includes(key)) {
      const err = new Error(
        'No `loopback` keyword found in ' +
          this.destinationPath('package.json') +
          '. ' +
          'The command must be run in a LoopBack project.',
      );
      this.exit(err);
    }
  }

  /**
   * Check if the generator should exit
   */
  shouldExit() {
    return !!this.exitGeneration;
  }

  /**
   * Print out the exit reason if this generator is told to exit before it ends
   */
  end() {
    if (this.shouldExit()) {
      debug(this.exitGeneration);
      this.log(chalk.red('Generation is aborted:', this.exitGeneration));
      return false;
    }
    return true;
  }
};
