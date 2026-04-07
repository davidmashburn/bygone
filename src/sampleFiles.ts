export interface SampleFilePair {
    leftFileName: string;
    rightFileName: string;
    leftContent: string;
    rightContent: string;
}

export function createJavaScriptSampleFilePair(): SampleFilePair {
    return {
        leftFileName: 'test-file-1.js',
        rightFileName: 'test-file-2.js',
        leftContent: `// Test File 1 - Example JavaScript Code
const fs = require('fs');
const path = require('path');

/**
 * A simple utility class for file operations
 */
class FileProcessor {
    constructor(directory = './') {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
    }

    // Method to read files from directory
    readFiles() {
        try {
            const files = fs.readdirSync(this.directory);
            this.files = files.filter(file => file.endsWith('.js'));
            console.log(\`Found \${this.files.length} JavaScript files\`);
        } catch (error) {
            console.error('Error reading directory:', error);
        }
    }

    // Process each file
    processFiles() {
        this.files.forEach(file => {
            try {
                const filePath = path.join(this.directory, file);
                fs.readFileSync(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Processed: \${file}\`);
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
            }
        });
    }

    // Get processing results
    getResults() {
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory
        };
    }
}

// Usage example
const processor = new FileProcessor('./src');
processor.readFiles();
processor.processFiles();
const results = processor.getResults();
console.log('Results:', results);

module.exports = FileProcessor;
`,
        rightContent: `// Test File 2 - Modified JavaScript Code
const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * An enhanced utility class for file operations
 * Added more features and error handling
 */
class FileProcessor {
    constructor(directory = './', options = {}) {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
        this.options = { recursive: false, ...options };
        this.startTime = Date.now();
    }

    // Enhanced method to read files from directory
    readFiles() {
        try {
            const items = fs.readdirSync(this.directory);
            this.files = items.filter(item => {
                const itemPath = path.join(this.directory, item);
                const stat = fs.statSync(itemPath);
                return stat.isFile() && item.endsWith('.js');
            });
            console.log(\`Found \${this.files.length} JavaScript files in \${this.directory}\`);
        } catch (error) {
            throw new Error(\`Failed to read directory \${this.directory}: \${error.message}\`);
        }
    }

    // Enhanced file processing with async support
    async processFiles() {
        const promises = this.files.map(async (file) => {
            try {
                const filePath = path.join(this.directory, file);
                const content = await util.promisify(fs.readFile)(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Successfully processed: \${file}\`);
                return { file, content };
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
                return { file, error: error.message };
            }
        });

        const results = await Promise.all(promises);
        return results.filter(result => !result.error);
    }

    // Get enhanced processing results
    getResults() {
        const duration = Date.now() - this.startTime;
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory,
            duration: \`\${duration}ms\`,
            options: this.options
        };
    }

    // New method to clean up files
    cleanUp() {
        console.log('Cleaning up resources...');
        this.files = [];
        this.processedCount = 0;
    }
}

// Enhanced usage example
async function main() {
    const processor = new FileProcessor('./src', { recursive: true });
    processor.readFiles();
    await processor.processFiles();
    const results = processor.getResults();
    console.log('Processing complete:', results);
    processor.cleanUp();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = FileProcessor;
`
    };
}
