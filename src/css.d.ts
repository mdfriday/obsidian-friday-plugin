/**
 * Type declarations for CSS module imports
 * This allows TypeScript to handle dynamic CSS imports
 */
declare module '*.css' {
	const content: void;
	export default content;
}

