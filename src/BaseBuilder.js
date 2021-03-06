import Immutable from 'immutable';
import tcomb from 'tcomb-validation';

import { validation } from './combinators';
import * as validators from './validators';

const initialState = {
  // Used to internally set fields which will later be realized into type and
  // options objects.
  _fieldBuilders: Immutable.Map(),

  // Used to wrap this builder's type in a maybe to make it optional.
  _isOptional: false,

  // Used to lazily close over the `_lazyTemplateProvider` until the options blob is
  // realized.
  _templateProviderCallback: null,

  // Used to recursively provide the template provider to all fields which
  // define a template in the options object.
  _lazyTemplateProvider: null,

  // Used to lazily set the type internally in the builder.
  _type: null,

  // Directly returned from the builder.
  options: Immutable.Map(),
};

export default class BaseBuilder {
  constructor(state = Immutable.Map(initialState)) {
    this._state = state;
  }

  /**
   * Set the disabled flag in the options object for this type.
   *
   * @param {boolean} disabled
   * @return {BaseBuilder}
   */
  setDisabled(disabled) {
    return new BaseBuilder(this._state.mergeDeep({ options: { disabled } }));
  }

  /**
   * Set the label in the options object for this type.
   *
   * @param {string} label
   * @return {BaseBuilder}
   */
  setLabel(label) {
    return new BaseBuilder(this._state.mergeDeep({ options: { label } }));
  }

  /**
   * Set the name in the options object for this type.
   *
   * @param {string} name
   * @return {BaseBuilder}
   */
  setName(name) {
    return new BaseBuilder(this._state.mergeDeep({ options: { name } }));
  }

  /**
   * Set the value in the options object for this type.
   *
   * @param {string} value
   * @return {BaseBuilder}
   */
  setValue(value) {
    return new BaseBuilder(this._state.mergeDeep({ options: { value } }));
  }

  /**
   * Set the text in the options object for this type.
   *
   * @param {string} text
   * @return {BaseBuilder}
   */
  setText(text) {
    return new BaseBuilder(this._state.mergeDeep({ options: { text } }));
  }

  /**
   * Set the help text in the options object for this type.
   *
   * @param {string} label
   * @return {BaseBuilder}
   */
  setHelp(help) {
    return new BaseBuilder(this._state.mergeDeep({ options: { help } }));
  }

  /**
   * Set a template provider class in the options object directory. If a lazy
   * template factory is already set on the builder, setting a concrete
   * template factory using this method will supersede the lazy one.
   *
   * @param {factory} factory - A template provider class
   * @return {BaseBuilder}
   */
  setTemplateFactory(factory) {
    return new BaseBuilder(this._state.mergeDeep({ options: { factory } }));
  }

  /**
   * Set the builder-specific `_templateProviderCallback` function which, when
   * this builder is realized, will be used to set the `factory` field on
   * the options object. By setting the template provider using a callback, a
   * `LazyTemplateProvider` instance can be made available to all sub-fields
   * recursively.
   *
   * @param {callback} callback - Function which takes a `LazyTemplateProvider`
   * instance and returns a template provider class
   * @return {BaseBuilder}
   */
  setLazyTemplateFactory(callback) {
    return new BaseBuilder(
      this._state.set('_templateProviderCallback', callback),
    );
  }

  /**
   * Set the error message function in the options object for this type.
   * Override any existing errors.
   *
   * @param {getValidationErrorMessage} error
   * @return {BaseBuilder}
   */
  setValidationErrorMessageFn(error) {
    return new BaseBuilder(this._state.mergeDeep({ options: { error } }));
  }

  /**
   * Set the transformer function in the options object for this type.
   *
   * @param {transformer} transformer
   * @return {BaseBuilder}
   */
  setTransformer(transformer) {
    return new BaseBuilder(this._state.mergeDeep({ options: { transformer } }));
  }

  /**
   * Add an error message function to the existing function in the options
   * object for this type. If there are no errors already set, then it is
   * equivalent to `setValidationErrorMessageFn`.
   *
   * @param {getValidationErrorMessage} error
   * @return {BaseBuilder}
   */
  addValidationErrorMessageFn(error) {
    const existingError = this._state.getIn(['options', 'error'], null);
    if (!existingError) {
      return this.setValidationErrorMessageFn(error);
    }

    return new BaseBuilder(this._state.mergeDeep({
      options: { error: validators.combine([existingError, error]) },
    }));
  }

  /**
   * Set a sub-field on this builder. The sub-field remains a builder type in
   * the internal only `_fieldBuilders` object until the current builder is
   * realized, at which point it will be used to construct the type hierarchy
   * and options object.
   *
   * @param {string} key
   * @param {BaseBuilder} fieldBuilder - a sub-field to set on this builder
   * @return {BaseBuilder}
   */
  setField(key, fieldBuilder) {
    if (this._state.getIn(['options', 'options'])) {
      throw new Error('Tried to set a field, but a select option was already added. '
          + 'Select options and fields are mutually exclusive.');
    }

    return new BaseBuilder(
      this._state
        .setIn(['_fieldBuilders', key], fieldBuilder)
        .updateIn(['options', 'order'], Immutable.List(), arr => arr.push(key)),
    );
  }

  /**
   * Add a select option to this builder. Select options allow you to use value
   * types in a dropdown form that would otherwise be impossible to represent
   * with only the tcomb enum type. All dropdowns that can be represented with
   * enums alone should continue to use enums; this method is for special cases
   * only.
   *
   * In the following example, the options list is constructed using
   * addSelectOption.
   *
   * {
   *   label: 'Label is just here for context; it is not actually set by this function.',
   *   options: [
   *     { value: true, text: 'Into Bruce Springsteen' },
   *     { value: false, text: 'Not into Bruce Springsteen' }
   *   ],
   * }
   *
   * @param {BaseBuilder} selectBuilder - an options object to add to the
   * select options fields
   * @return {BaseBuilder}
   */
  addSelectOption(selectBuilder) {
    if (!this._state.get('_fieldBuilders').isEmpty()) {
      throw new Error('Tried to add a select option, but a field was already set. '
          + 'Select options and fields are mutually exclusive.');
    }

    const selectOptions = Immutable.fromJS(selectBuilder.getOptions());
    return new BaseBuilder(
      this._state.updateIn(['options', 'options'],
        Immutable.List(),
        arr => arr.push(selectOptions)),
    );
  }

  /**
   * Set the tcomb type of this builder. In order to allow for arbitrary
   * ordering of builder commands, wait to realize the type until the `getType`
   * method is called.
   *
   * @param {typeCombinatorCallback} typeCombinator - set a lazily executed
   * type on the internal state
   * @return {BaseBuilder}
   */
  setType(typeCombinator) {
    return new BaseBuilder(this._state.set(
      '_type',
      (error, subTypes) => typeCombinator(error, subTypes),
    ));
  }

  /**
   * Convenience function for setting the type and using the built-in
   * validation defined by the type.
   * @param {type}
   * type on the internal state
   * @return {BaseBuilder}
   */
  setTypeAndValidate(type, name) {
    return this.setType(errorFn => validation(type, errorFn, name));
  }

  /**
   * Sets a template provider instance. Set the provider only on the top level
   * type, and it will be used to recursively generate templates for all
   * sub-field options objects.
   *
   * @param {LazyTemplateProvider} provider
   * @return {BaseBuilder}
   */
  setLazyTemplateProvider(provider) {
    return new BaseBuilder(this._state.set('_lazyTemplateProvider', provider));
  }

  /**
   * Set a field as optional. The type is wrapper in tcomb.maybe() when
   * `getType()` is called.
   *
   * @return {BaseBuilder}
   */
  makeOptional() {
    return new BaseBuilder(this._state.set('_isOptional', true));
  }

  /**
   * Given a select builder that contains a value and some text (see the
   * addSelectOption method), set a default option in a dropdown field.
   *
   * @param {BaseBuilder} selectBuilder
   * @return {BaseBuilder}
   */
  setNullOption(selectBuilder) {
    const nullOption = selectBuilder.getOptions();
    return new BaseBuilder(this._state.mergeDeep({ options: { nullOption } }));
  }

  /**
   * Set a placeholder in the options blob for this field.
   *
   * @return {BaseBuilder}
   */
  setPlaceholder(placeholder) {
    return new BaseBuilder(this._state.mergeDeep({ options: { attrs: { placeholder } } }));
  }


  /**
   * Set whether or not this field should autofocus.
   *
   * @return {BaseBuilder}
   */
  setAutoFocus(autoFocus) {
    return new BaseBuilder(this._state.mergeDeep({ options: { attrs: { autoFocus } } }));
  }

  /**
   * Set config in the options blob for this field. As a pass-through to
   * configure the template.
   *
   * @param {object}
   * @return {BaseBuilder}
   */
  setConfig(config) {
    return new BaseBuilder(this._state.mergeDeep({ options: { config } }));
  }

  /**
   * For unit testing. Disable templates when calling the getOptions function.
   *
   * @return {BaseBuilder}
   */
  _disableTemplates() {
    return new BaseBuilder(this._state.set('_disableTemplates', true));
  }

  /**
   * Return a realized type. Lazily realize the type so that the most recent
   * versions of the `error` function and `_fieldBuilders` object are
   * available.
   *
   * @return {tcomb.type}
   */
  getType() {
    const type = () => {
      if (this._state.get('_fieldBuilders').isEmpty()) {
        return this._state.get('_type')(this._state.getIn(['options', 'error']));
      }

      // Recursively get the type of every sub-field and represent this at the top
      // level as a javascript object of field names to types.
      const subTypes = this._state.get('_fieldBuilders').entrySeq().reduce((acc, entry) => {
        const key = entry[0];
        const field = entry[1];

        return acc.set(key, field.getType());
      }, Immutable.Map()).toJS();

      // Determine and return the type of the current builder.
      return this._state.get('_type')(
        this._state.getIn(['options', 'error']),
        subTypes,
      );
    };

    return this._state.get('_isOptional') ? tcomb.maybe(type()) : type();
  }

  /**
   * Return a realized options object. Lazily realize the options object so
   * that the template provider from the top builder can be made available
   * to all sub-builders.
   *
   * @return {object}
   */
  getOptions(lazyTemplateProvider, config = {}) {
    const {
      disableTemplates = this._state.get('_disableTemplates', false),
    } = config;

    const provider = lazyTemplateProvider || this._state.get('_lazyTemplateProvider');

    const hasConcreteTemplateFactory = this._state.hasIn(['options', 'factory']);

    if (!hasConcreteTemplateFactory
        && this._state.get('_templateProviderCallback')
        && !provider
        && !disableTemplates) {
      throw new Error('A template callback function was specified, but no provider was set');
    }

    // Recursively build up the options object from every field.
    const fields = this._state.get('_fieldBuilders').entrySeq().reduce((acc, entry) => {
      const key = entry[0];
      const field = entry[1];

      return acc.setIn(['options', 'fields', key],
        field.getOptions(provider, { disableTemplates }));
    }, Immutable.Map()).toJS();

    // If a template callback exists, realize the template, merge any
    // sub-fields, and return the resulting options object.
    const templateProviderCallback = this._state.get('_templateProviderCallback');
    const options = !hasConcreteTemplateFactory && templateProviderCallback && !disableTemplates
      ? this._state.mergeDeep({ options: { factory: templateProviderCallback(provider) } })
      : this._state;

    return options
      .mergeDeep(fields)
      .get('options')
      .toJS();
  }
}
