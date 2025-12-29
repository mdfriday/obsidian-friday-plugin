class Context<T extends Record<string | number | symbol, any> = object> {
    _data: Partial<T> = {};
    children: WeakRef<Context<T>>[] = [];
    parent?: Context<T>;

    constructor(base?: Context<T>, data?: Partial<T>) {
        this.parent = base;
        if (data) {
            this._data = data;
        }
    }

    set<V extends keyof T>(key: V, value: T[V]) {
        // Normally, copy on write.
        this._data[key] = value;
    }

    get<V extends keyof T>(key: V): T[V] | undefined {
        if (key in this._data) {
            return this._data[key];
        } else {
            if (this.parent) {
                return this.parent.get(key);
            }
            return undefined;
        }
    }
    setInGlobalContext<V extends keyof T>(key: V, value: T[V]) {
        if (this.parent) {
            delete this._data[key];
            this.parent.setInGlobalContext(key, value);
        } else {
            this.set(key, value);
        }
    }

    setInNearestContext<V extends keyof T>(key: V, value: T[V]) {
        if (key in this._data) {
            this.set(key, value);
        } else {
            if (this.parent) {
                this.parent.setInNearestContext(key, value);
            } else {
                this.set(key, value);
            }
        }
    }

    spawnContext<V extends Record<string, any>>(data?: V) {
        const child = new Context<V & T>(this, data as Partial<V & T>);
        this.children.push(new WeakRef(child));
        return child;
    }
    _disposeChild(child: Context<any>) {
        this.children = this.children.filter((wr) => wr.deref() === child);
        // Clean up empty children
        this.children = this.children.filter((wr) => wr.deref() === undefined);
    }
    dispose() {
        this.parent?._disposeChild(this);
    }
}

const rootContext = new Context<object>();
export function getContext<T extends U, U extends Record<string, any> = object>(data?: T) {
    return rootContext.spawnContext<T>(data);
}
export function getIndependentContext<T extends U, U extends Record<string, any> = object>(data?: T) {
    return new Context<T>(undefined, data);
}
