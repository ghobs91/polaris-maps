import { resolveOsmEditAction } from '../../src/utils/osmEditAction';

describe('resolveOsmEditAction', () => {
  it('edits the matched OSM node', () => {
    expect(resolveOsmEditAction({ type: 'node', id: 42 }, false)).toEqual({
      kind: 'edit',
      nodeId: 42,
    });
  });

  it('reports a way match as not editable here, even when creation is allowed', () => {
    expect(resolveOsmEditAction({ type: 'way', id: 99 }, true)).toEqual({
      kind: 'mapped-as-other',
      type: 'way',
      id: 99,
    });
  });

  it('reports a relation match as not editable here', () => {
    expect(resolveOsmEditAction({ type: 'relation', id: 5 }, false)).toEqual({
      kind: 'mapped-as-other',
      type: 'relation',
      id: 5,
    });
  });

  it('offers creation for an unmapped place when creating is appropriate', () => {
    expect(resolveOsmEditAction(null, true)).toEqual({ kind: 'create' });
  });

  it('reports an unmapped place when creating is not appropriate', () => {
    expect(resolveOsmEditAction(null, false)).toEqual({ kind: 'not-mapped' });
  });
});
