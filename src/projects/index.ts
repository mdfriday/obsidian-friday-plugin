/**
 * Projects module - Site project management
 * 
 * This module provides functionality for managing site project configurations,
 * allowing users to save and restore their site settings, content paths,
 * theme selections, and build history.
 */

export { ProjectManagementModal } from './modal';
export { ProjectService } from './service';
export type { 
	ProjectConfig, 
	ProjectLanguageContent, 
	ProjectBuildHistory, 
	ProjectsData 
} from './types';

