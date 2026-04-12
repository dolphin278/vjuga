/**
 * RadixTree — a compressed trie (patricia trie) mapping string keys to values.
 *
 * Inspired by Fastify's find-my-way radix tree router, this implementation
 * stores keys by splitting them into shared prefixes among internal nodes.
 * Each node holds a prefix string, an optional value, and a sorted array of
 * children (sorted by the first character of each child's prefix for binary
 * search).
 *
 * Internal design:
 *   kPrefix:   string            — the compressed prefix for this node
 *   kValue:    T | undefined     — the value stored at this node (undefined = no value)
 *   kChildren: RadixNode<T>[]    — children sorted by first char of their prefix
 *   kRoot:     RadixNode<T>      — root node of the tree (prefix = "")
 *   kSize:     number            — total number of key-value pairs in the tree
 *
 * The children array is sorted so that lookups can use binary search over the
 * first character of each child's prefix. This gives O(log k) child lookup
 * where k is the branching factor, which is superior to a linear scan for
 * nodes with many children (e.g., URL routers with many first-path-segment
 * variations).
 *
 * All traversals use explicit loops with a stack array rather than recursion
 * to avoid call-stack growth on deep trees and to keep the JIT's inlining
 * budget free for the leaf operations.
 *
 * All fields use module-scope unique symbols so V8 compiles property access
 * to integer slot offsets — no string-keyed dictionary lookup.
 *
 * When to use: key spaces with shared string prefixes where prefix-based
 * retrieval is needed alongside exact lookup — URL routing, file-path
 * indexing, autocomplete, IP prefix matching. For exact-match-only
 * dictionaries without prefix queries, a plain `Map` is simpler and faster.
 * RadixTree outperforms `Map` for `prefixMatch` because it walks only the
 * relevant subtree rather than iterating all entries.
 */

const kPrefix: unique symbol = Symbol("prefix");
const kValue: unique symbol = Symbol("value");
const kChildren: unique symbol = Symbol("children");
const kRoot: unique symbol = Symbol("root");
const kSize: unique symbol = Symbol("size");

/**
 * Internal node type — not exported. Each node stores a prefix string, an
 * optional value, and a sorted array of children.
 */
interface RadixNode<T> {
  [kPrefix]: string;
  [kValue]: T | undefined;
  [kChildren]: RadixNode<T>[];
}

export interface RadixTree<T> {
  [kRoot]: RadixNode<T>;
  [kSize]: number;
}

/**
 * Creates a new RadixNode. The kChildren field is double-written because it
 * will be mutated (push/splice) after construction — forcing V8 to treat it
 * as mutable from the first allocation avoids a deopt cascade when the first
 * child is added.
 */
function makeNode<T>(prefix: string, value: T | undefined): RadixNode<T> {
  const node: RadixNode<T> = {
    [kPrefix]: prefix,
    [kValue]: value,
    [kChildren]: [],
  };
  // Double-write kChildren so V8 marks it mutable from first construction.
  // Without this, the first mutation (push/splice) triggers a deoptimization
  // cascade on every compiled function that reads this field.
  node[kChildren] = [];
  return node;
}

/**
 * Creates a new empty RadixTree.
 */
export function make<T>(): RadixTree<T> {
  const tree: RadixTree<T> = {
    [kRoot]: makeNode<T>("", undefined),
    [kSize]: 0,
  };
  // Double-write kSize so V8 marks it mutable from first construction.
  // Without this, the first insert triggers a deopt cascade on every compiled
  // function that reads kSize.
  tree[kSize] = 0;
  return tree;
}

/**
 * Binary search for a child whose prefix starts with the given character.
 * Returns the index of the matching child, or -1 if not found.
 *
 * Uses a classic binary search over the sorted children array. The sort key
 * is the first character of each child's prefix (charCodeAt(0)). This is
 * O(log k) where k is the number of children — faster than a linear scan
 * for high branching factors.
 */
function findChild<T>(children: RadixNode<T>[], char: number): number {
  let lo = 0;
  let hi = children.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midChar = children[mid][kPrefix].charCodeAt(0);
    if (midChar === char) return mid;
    if (midChar < char) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
}

/**
 * Binary search to find the sorted insertion index for a child whose prefix
 * starts with the given character. Returns the index where the child should
 * be inserted to maintain sort order.
 */
function findInsertionIndex<T>(children: RadixNode<T>[], char: number): number {
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (children[mid][kPrefix].charCodeAt(0) < char) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Inserts a key-value pair into the tree. If the key already exists, its
 * value is overwritten.
 *
 * Algorithm: walk the tree character by character. At each node, find the
 * child whose prefix shares a common prefix with the remaining key. If the
 * child's prefix partially matches, split the child node. Create a new leaf
 * for the remaining characters.
 */
export function insert<T>(tree: RadixTree<T>, key: string, value: T): void {
  let node = tree[kRoot];
  let remaining = key;

  // Explicit loop — no recursion — keeps JIT inlining budget free and avoids
  // call-stack growth on deep trees.
  for (;;) {
    // If there is no remaining key, store the value at this node.
    if (remaining.length === 0) {
      if (node[kValue] === undefined) {
        tree[kSize]++;
      }
      node[kValue] = value;
      return;
    }

    const children = node[kChildren];
    const firstChar = remaining.charCodeAt(0);
    const childIdx = findChild(children, firstChar);

    if (childIdx === -1) {
      // No child matches — create a new leaf node.
      const newNode = makeNode(remaining, value);
      const insertIdx = findInsertionIndex(children, firstChar);
      // splice into sorted position to maintain children sort order
      children.splice(insertIdx, 0, newNode);
      tree[kSize]++;
      return;
    }

    const child = children[childIdx];
    const childPrefix = child[kPrefix];

    // Find the length of the common prefix between remaining and childPrefix.
    // Using an explicit for loop with charCodeAt for speed — avoids creating
    // substring objects until we know we need them.
    let commonLen = 0;
    const maxLen = remaining.length < childPrefix.length ? remaining.length : childPrefix.length;
    for (; commonLen < maxLen; commonLen++) {
      if (remaining.charCodeAt(commonLen) !== childPrefix.charCodeAt(commonLen)) {
        break;
      }
    }

    if (commonLen === childPrefix.length) {
      // The child's prefix is fully consumed — descend into the child with
      // the remainder of the key.
      remaining = remaining.substring(commonLen);
      node = child;
      continue;
    }

    // Partial match — we need to split the child node.
    // Create an intermediate node with the common prefix portion.
    const splitNode = makeNode<T>(childPrefix.substring(0, commonLen), undefined);

    // Adjust the existing child's prefix to only the non-shared suffix.
    child[kPrefix] = childPrefix.substring(commonLen);

    // The split node adopts the existing child as its own child.
    splitNode[kChildren].push(child);

    if (commonLen === remaining.length) {
      // The key ends exactly at the split point — store value on split node.
      splitNode[kValue] = value;
    } else {
      // There is still a remainder — create a new leaf for it.
      const leafNode = makeNode(remaining.substring(commonLen), value);
      // Insert the leaf in sorted order among splitNode's children.
      const leafChar = leafNode[kPrefix].charCodeAt(0);
      const leafIdx = findInsertionIndex(splitNode[kChildren], leafChar);
      splitNode[kChildren].splice(leafIdx, 0, leafNode);
    }

    // Replace the original child with the split node in the parent's children.
    children[childIdx] = splitNode;
    tree[kSize]++;
    return;
  }
}

/**
 * Looks up a key in the tree.
 * Returns the associated value, or undefined if not found.
 *
 * Walk down the tree matching prefixes. If we exhaust the key exactly at a
 * node that holds a value, return it. Otherwise return undefined.
 */
export function lookup<T>(tree: RadixTree<T>, key: string): T | undefined {
  let node = tree[kRoot];
  let remaining = key;

  // Explicit loop — avoids recursion overhead.
  for (;;) {
    if (remaining.length === 0) {
      return node[kValue];
    }

    const children = node[kChildren];
    const childIdx = findChild(children, remaining.charCodeAt(0));
    if (childIdx === -1) return undefined;

    const child = children[childIdx];
    const childPrefix = child[kPrefix];

    // Check if the remaining key starts with the child's prefix.
    // Manual character comparison loop avoids creating substring objects
    // on the hot path — only charCodeAt comparisons are needed.
    if (remaining.length < childPrefix.length) return undefined;
    for (let i = 0; i < childPrefix.length; i++) {
      if (remaining.charCodeAt(i) !== childPrefix.charCodeAt(i)) {
        return undefined;
      }
    }

    remaining = remaining.substring(childPrefix.length);
    node = child;
  }
}

/**
 * Returns true if the key exists in the tree (i.e., has a stored value).
 */
export function has<T>(tree: RadixTree<T>, key: string): boolean {
  return lookup(tree, key) !== undefined;
}

/**
 * Returns the number of key-value pairs in the tree.
 */
export function size<T>(tree: RadixTree<T>): number {
  return tree[kSize];
}

/**
 * Removes a key from the tree. Returns true if the key was present, false otherwise.
 *
 * After clearing the value, attempts to merge nodes when a branch becomes
 * unnecessary: if a node has no value and exactly one child, it can be
 * merged with that child by concatenating their prefixes.
 *
 * We track the path of (parent, childIndex) pairs so we can walk back up
 * and perform merges without recursion.
 */
export function remove<T>(tree: RadixTree<T>, key: string): boolean {
  let node = tree[kRoot];
  let remaining = key;

  // Track the path so we can merge nodes on the way back up.
  // Each entry is [parentNode, childIndex] — the child at that index is the
  // next node in the walk.
  const path: [RadixNode<T>, number][] = [];

  // Walk down to find the node.
  for (;;) {
    if (remaining.length === 0) {
      break;
    }

    const children = node[kChildren];
    const childIdx = findChild(children, remaining.charCodeAt(0));
    if (childIdx === -1) return false;

    const child = children[childIdx];
    const childPrefix = child[kPrefix];

    if (remaining.length < childPrefix.length) return false;
    for (let i = 0; i < childPrefix.length; i++) {
      if (remaining.charCodeAt(i) !== childPrefix.charCodeAt(i)) {
        return false;
      }
    }

    path.push([node, childIdx]);
    remaining = remaining.substring(childPrefix.length);
    node = child;
  }

  // Node found — check if it has a value.
  if (node[kValue] === undefined) return false;

  node[kValue] = undefined;
  tree[kSize]--;

  // --- Merge pass ---
  // Walk back up the path and merge unnecessary nodes.
  // A node with no value and exactly one child can be merged with that child.
  // A node with no value and no children can be removed from its parent.

  // First, handle the target node itself:
  // If it has no children, remove it from its parent entirely.
  // If it has exactly one child, merge it with the child.
  if (node[kChildren].length === 0 && path.length > 0) {
    // Leaf node with no value — remove from parent.
    const [parent, idx] = path[path.length - 1];
    parent[kChildren].splice(idx, 1);

    // After removing, check if the parent (which is not the root) can be merged.
    // A parent with no value and exactly one child can merge with that child.
    if (path.length >= 2) {
      const parentHasValue = parent[kValue] !== undefined;
      if (!parentHasValue && parent[kChildren].length === 1) {
        const onlyChild = parent[kChildren][0];
        parent[kPrefix] = parent[kPrefix] + onlyChild[kPrefix];
        parent[kValue] = onlyChild[kValue];
        parent[kChildren] = onlyChild[kChildren];
      }
    }
  } else if (node[kChildren].length === 1 && path.length > 0) {
    // Internal node with no value and one child — merge with child.
    const onlyChild = node[kChildren][0];
    node[kPrefix] = node[kPrefix] + onlyChild[kPrefix];
    node[kValue] = onlyChild[kValue];
    node[kChildren] = onlyChild[kChildren];
  }

  return true;
}

/**
 * Returns all values whose keys start with the given prefix.
 *
 * Walks the tree to find the node where the prefix ends, then collects all
 * values in the subtree rooted at that node using an explicit stack (no
 * recursion — avoids call-stack growth on wide/deep subtrees).
 */
export function prefixMatch<T>(tree: RadixTree<T>, prefix: string): T[] {
  let node = tree[kRoot];
  let remaining = prefix;

  // Walk to the node matching the prefix.
  for (;;) {
    if (remaining.length === 0) {
      break;
    }

    const children = node[kChildren];
    const childIdx = findChild(children, remaining.charCodeAt(0));
    if (childIdx === -1) return [];

    const child = children[childIdx];
    const childPrefix = child[kPrefix];

    if (remaining.length < childPrefix.length) {
      // The remaining prefix is shorter than the child's prefix.
      // Check if the child's prefix starts with the remaining prefix —
      // if so, the child's subtree contains all matches.
      for (let i = 0; i < remaining.length; i++) {
        if (remaining.charCodeAt(i) !== childPrefix.charCodeAt(i)) {
          return [];
        }
      }
      // The child's prefix extends past the query prefix — collect from child subtree.
      node = child;
      remaining = "";
      break;
    }

    // Check prefix match character by character.
    for (let i = 0; i < childPrefix.length; i++) {
      if (remaining.charCodeAt(i) !== childPrefix.charCodeAt(i)) {
        return [];
      }
    }

    remaining = remaining.substring(childPrefix.length);
    node = child;
  }

  // Collect all values in the subtree using an explicit stack.
  // Stack-based DFS avoids recursion and keeps the JIT's inlining budget
  // free for the inner loop.
  const result: T[] = [];
  const stack: RadixNode<T>[] = [node];

  for (let top = 0; top < stack.length; top++) {
    const current = stack[top];
    if (current[kValue] !== undefined) {
      result.push(current[kValue]);
    }
    const ch = current[kChildren];
    // Push children in reverse order so they are visited in sorted order
    // (leftmost child is popped last from stack, but since we iterate
    // forward through the stack array, we push in forward order).
    for (let i = 0; i < ch.length; i++) {
      stack.push(ch[i]);
    }
  }

  return result;
}

/**
 * Returns all key-value pairs in the tree as an array of [key, value] tuples.
 *
 * Uses an explicit stack of [node, accumulated-key] pairs rather than
 * recursion — avoids call-stack growth and keeps the JIT inlining budget
 * available for leaf operations.
 */
export function entries<T>(tree: RadixTree<T>): [string, T][] {
  const result: [string, T][] = [];
  // Stack entries are [node, accumulated key prefix].
  const stack: [RadixNode<T>, string][] = [[tree[kRoot], ""]];

  for (let top = 0; top < stack.length; top++) {
    const [current, accKey] = stack[top];
    if (current[kValue] !== undefined) {
      result.push([accKey, current[kValue]]);
    }
    const ch = current[kChildren];
    for (let i = 0; i < ch.length; i++) {
      stack.push([ch[i], accKey + ch[i][kPrefix]]);
    }
  }

  return result;
}
