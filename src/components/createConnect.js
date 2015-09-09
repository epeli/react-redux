import createStoreShape from '../utils/createStoreShape';
import shallowEqual from '../utils/shallowEqual';
import isPlainObject from '../utils/isPlainObject';
import wrapActionCreators from '../utils/wrapActionCreators';
import invariant from 'invariant';

const defaultMapStateToProps = () => ({});
const defaultMapDispatchToProps = dispatch => ({ dispatch });
const defaultMergeProps = (stateProps, dispatchProps, parentProps) => ({
  ...parentProps,
  ...stateProps,
  ...dispatchProps
});

function getDisplayName(Component) {
  return Component.displayName || Component.name || 'Component';
}

// Helps track hot reloading.
let nextVersion = 0;

export default function createConnect(React) {
  const { Component, PropTypes } = React;
  const storeShape = createStoreShape(PropTypes);

  // Avoids rendering if the props did not change
  class PureWrap extends Component {
    shouldComponentUpdate(nextProps) {
      return !shallowEqual(this.props.passProps, nextProps.passProps);
    }
    render() {
      const PureWrappedComponent = this.props.component;
      return <PureWrappedComponent ref='wrappedInstance' {...this.props.passProps} />;
    }
  }


  return function connect(mapStateToProps, mapDispatchToProps, mergeProps, options = {}) {
    const shouldSubscribe = Boolean(mapStateToProps);
    const finalMapStateToProps = mapStateToProps || defaultMapStateToProps;
    const finalMapDispatchToProps = isPlainObject(mapDispatchToProps) ?
      wrapActionCreators(mapDispatchToProps) :
      mapDispatchToProps || defaultMapDispatchToProps;
    const finalMergeProps = mergeProps || defaultMergeProps;
    const shouldUpdateStateProps = finalMapStateToProps.length > 1;
    const shouldUpdateDispatchProps = finalMapDispatchToProps.length > 1;
    const { pure = true } = options;

    // Helps track hot reloading.
    const version = nextVersion++;

    function computeStateProps(storeState, props) {
      const stateProps = shouldUpdateStateProps ?
        finalMapStateToProps(storeState, props) :
        finalMapStateToProps(storeState);

      invariant(
        isPlainObject(stateProps),
        '`mapStateToProps` must return an object. Instead received %s.',
        stateProps
      );
      return stateProps;
    }

    function computeDispatchProps(store, props) {
      const { dispatch } = store;
      const dispatchProps = shouldUpdateDispatchProps ?
        finalMapDispatchToProps(dispatch, props) :
        finalMapDispatchToProps(dispatch);

      invariant(
        isPlainObject(dispatchProps),
        '`mapDispatchToProps` must return an object. Instead received %s.',
        dispatchProps
      );
      return dispatchProps;
    }

    function computeNextState(stateProps, dispatchProps, parentProps) {
      const mergedProps = finalMergeProps(stateProps, dispatchProps, parentProps);
      invariant(
        isPlainObject(mergedProps),
        '`mergeProps` must return an object. Instead received %s.',
        mergedProps
      );
      return mergedProps;
    }

    return function wrapWithConnect(WrappedComponent) {
      class Connect extends Component {
        static displayName = `Connect(${getDisplayName(WrappedComponent)})`;
        static WrappedComponent = WrappedComponent;

        static contextTypes = {
          store: storeShape
        };

        static propTypes = {
          store: storeShape
        };

        shouldComponentUpdate(nextProps, nextState) {
          return !pure || !shallowEqual(this.props, nextProps) ||
                          !shallowEqual(this.state, nextState);
        }

        constructor(props, context) {
          super(props, context);
          this.version = version;
          this.store = props.store || context.store;
          this.mapStateMemoize = null;

          invariant(this.store,
            `Could not find "store" in either the context or ` +
            `props of "${this.constructor.displayName}". ` +
            `Either wrap the root component in a <Provider>, ` +
            `or explicitly pass "store" as a prop to "${this.constructor.displayName}".`
          );

          this.state = {
            dispatchProps: computeDispatchProps(this.store, props),
            storeState: this.store.getState()
          };
        }


        updateDispatchProps(props = this.props) {
          this.setState({
            dispatchProps: computeDispatchProps(this.store, props)
          });
        }

        isSubscribed() {
          return typeof this.unsubscribe === 'function';
        }

        trySubscribe() {
          if (shouldSubscribe && !this.unsubscribe) {
            this.unsubscribe = this.store.subscribe(::this.handleChange);
            this.handleChange();
          }
        }

        tryUnsubscribe() {
          if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
          }
        }

        componentDidMount() {
          this.trySubscribe();
        }

        componentWillReceiveProps(nextProps) {
          if (!shallowEqual(nextProps, this.props)) {
            if (shouldUpdateDispatchProps) {
              this.updateDispatchProps(nextProps);
            }

            if (shouldUpdateStateProps) {
              this.mapStateMemoize = null;
            }
          }
        }

        componentWillUnmount() {
          this.tryUnsubscribe();
        }

        handleChange() {
          if (!this.unsubscribe) {
            return;
          }

          const storeState = this.store.getState()
          if (storeState !== this.state.storeState) {
            this.mapStateMemoize = null;
          }

          this.setState({storeState});
        }

        getWrappedInstance() {
          if (pure) {
            return this.refs.wrappedInstance.refs.wrappedInstance;
          } else {
            return this.refs.wrappedInstance;
          }
        }

        computeNextState() {
          if (this.mapStateMemoize === null) {
            this.mapStateMemoize = computeStateProps(this.state.storeState, this.props)
          }

          return computeNextState(
            this.mapStateMemoize,
            this.state.dispatchProps,
            this.props
          );
        }

        render() {

          const finalProps = this.computeNextState();

          if (!pure) {
            return <WrappedComponent {...finalProps} />;
          }

          return (
            <PureWrap
              ref='wrappedInstance'
              component={WrappedComponent}
              passProps={finalProps} />
          );
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        Connect.prototype.componentWillUpdate = function componentWillUpdate() {
          if (this.version === version) {
            return;
          }

          // We are hot reloading!
          this.version = version;

          this.mapStateMemoize = null;

          // Update the state and bindings.
          this.trySubscribe();
          this.updateDispatchProps();
        };
      }

      return Connect;
    };
  };
}
