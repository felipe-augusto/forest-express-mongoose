import _ from 'lodash';
import Interface from 'forest-express';
import OperatorDateIntervalParser from './operator-date-interval-parser';
import { NoMatchingOperatorError, InvalidFiltersFormatError } from './errors';
import utils from '../utils/schema';

const AGGREGATOR_OPERATORS = ['and', 'or'];

function FiltersParser(model, filtersString, timezone, options) {
  this.operatorDateIntervalParser = new OperatorDateIntervalParser(timezone);
  try {
    this.filters = filtersString ? JSON.parse(filtersString) : null;
  } catch (error) {
    throw new InvalidFiltersFormatError('Invalid filters JSON format');
  }


  this.perform = () => {
    if (!this.filters) return null;

    return this.formatAggregation(this.filters);
  };

  this.formatAggregation = (node) => {
    if (_.isEmpty(node)) throw new InvalidFiltersFormatError('Empty condition in filter');

    if (!node.aggregator) return this.formatCondition(node);
    if (node.conditions.length === 0) return null;

    const formatedAggregator = {};
    const formatedConditions = [];

    node.conditions.forEach(condition =>
      formatedConditions.push(this.formatAggregation(condition)));

    const aggregatorOperator = this.formatAggregatorOperator(node.aggregator);

    formatedAggregator[aggregatorOperator] = formatedConditions;
    return formatedAggregator;
  };

  this.formatCondition = (condition) => {
    if (_.isEmpty(condition)) throw new InvalidFiltersFormatError('Empty condition in filter');
    if (!condition.field) throw new InvalidFiltersFormatError('Bad condition format: missing field');

    const formatedCondition = {};
    const formatedField = this.formatField(condition.field);

    formatedCondition[formatedField] =
      this.formatOperatorValue(condition.field, condition.operator, condition.value);

    return formatedCondition;
  };

  this.parseFunction = (key) => {
    const schema = Interface.Schemas.schemas[utils.getModelName(model)];
    const fieldValues = key.split(':');
    const fieldName = fieldValues[0];
    const subfieldName = fieldValues[1];

    // Mongoose Aggregate don't parse the value automatically.
    let field = _.find(schema.fields, { field: fieldName });

    if (!field) throw new InvalidFiltersFormatError(`Field '${fieldName}' not found`);

    const isEmbeddedField = !!field.type.fields;
    if (isEmbeddedField) {
      field = _.find(field.type.fields, { field: subfieldName });
    }

    if (!field) return val => val;
    switch (field.type) {
      case 'Number':
        return parseInt;
      case 'Date':
        return val => new Date(val);
      case 'Boolean':
        return (val) => {
          if (val === 'true') { return true; }
          if (val === 'false') { return false; }
          return null;
        };
      case 'String':
        return (val) => {
          // NOTICE: Check if the value is a real ObjectID. By default, the
          // isValid method returns true for a random string with length 12.
          // Example: 'Black Friday'.
          if (options.mongoose.Types.ObjectId.isValid(val) &&
            options.mongoose.Types.ObjectId(val).toString() === val) {
            return options.mongoose.Types.ObjectId(val);
          }
          return val;
        };
      default:
        if (_.isArray(field.type)) {
          return val => ({ $size: val });
        }
        return val => val;
    }
  };

  this.formatAggregatorOperator = (aggregatorOperator) => {
    if (AGGREGATOR_OPERATORS.includes(aggregatorOperator)) return `$${aggregatorOperator}`;
    throw new NoMatchingOperatorError();
  };

  this.formatOperatorValue = (field, operator, value) => {
    if (this.operatorDateIntervalParser.isDateIntervalOperator(operator)) {
      return this.operatorDateIntervalParser.getDateIntervalFilter(operator, value);
    }

    const parseFct = this.parseFunction(field);

    switch (operator) {
      case 'not':
      case 'not_equal':
        return { $ne: parseFct(value) };
      case 'greater_than':
      case 'after':
        return { $gt: parseFct(value) };
      case 'less_than':
      case 'before':
        return { $lt: parseFct(value) };
      case 'contains':
        return new RegExp(`.*${parseFct(value)}.*`);
      case 'starts_with':
        return new RegExp(`^${parseFct(value)}.*`);
      case 'ends_with':
        return new RegExp(`.*${parseFct(value)}$`);
      case 'not_contains':
        return { $not: new RegExp(`.*${parseFct(value)}.*`) };
      case 'present':
        return { $exists: true };
      case 'blank':
        return { $exists: false };
      case 'equal':
        return parseFct(value);
      default:
        throw new NoMatchingOperatorError();
    }
  };

  this.formatField = field => (field.includes(':') ? `${field.replace(':', '.')}` : field);
}

module.exports = FiltersParser;
