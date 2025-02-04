import * as path from 'path'
import chalk from 'chalk'
import * as tsconfig from 'tsconfig'
import * as fsExtra from 'fs-extra'
import * as TSNode from 'ts-node'
import stripAnsi from 'strip-ansi'
import { PackageInfo } from './PackageInfo'
import { CodeBlockExtractor } from './CodeBlockExtractor'
import { LocalImportSubstituter } from './LocalImportSubstituter'

type CodeBlock = {
  readonly file: string
  readonly index: number
  readonly snippet: string
  readonly sanitisedCode: string
}

export type SnippetCompilationResult = {
  readonly file: string
  readonly index: number
  readonly snippet: string
  readonly linesWithErrors: number[]
  readonly error?: TSNode.TSError | Error
}

const COMPILED_DOCS_FILE_PREFIX_PATTERN = /(.*)\/compiled-docs\/block-\d+\.ts/g

export class SnippetCompiler {
  private readonly compiler: TSNode.Service

  constructor (private readonly workingDirectory: string) {
    const configOptions = SnippetCompiler.loadTypeScriptConfig()
    this.compiler = TSNode.create(configOptions.config)
  }

  private static loadTypeScriptConfig (): any {
    const typeScriptConfig = tsconfig.loadSync(process.cwd())
    if (typeScriptConfig?.config?.compilerOptions) {
      typeScriptConfig.config.compilerOptions.noUnusedLocals = false
    }
    return typeScriptConfig
  }

  async compileSnippets (documentationFiles: string[]): Promise<SnippetCompilationResult[]> {
    try {
      await this.cleanWorkingDirectory()
      await fsExtra.ensureDir(this.workingDirectory)
      const examples = await this.extractAllCodeBlocks(documentationFiles)
      return await Promise.all(
        examples.map(async (example) => await this.testCodeCompilation(example))
      )
    } finally {
      await this.cleanWorkingDirectory()
    }
  }

  private async cleanWorkingDirectory () {
    return await fsExtra.remove(this.workingDirectory)
  }

  private async extractAllCodeBlocks (documentationFiles: string[]) {
    const packageDefn = await PackageInfo.read()
    const importSubstituter = new LocalImportSubstituter(packageDefn)

    const codeBlocks = await Promise.all(documentationFiles.map(async (file) => await this.extractFileCodeBlocks(file, importSubstituter)))
    return codeBlocks.flat()
  }

  private async extractFileCodeBlocks (file: string, importSubstituter: LocalImportSubstituter): Promise<CodeBlock[]> {
    const blocks = await CodeBlockExtractor.extract(file)
    return blocks.map((block: string, index) => {
      return {
        file,
        snippet: block,
        index: index + 1,
        sanitisedCode: this.sanitiseCodeBlock(importSubstituter, block)
      }
    })
  }

  private sanitiseCodeBlock (importSubstituter: LocalImportSubstituter, block: string): string {
    const localisedBlock = importSubstituter.substituteLocalPackageImports(block)
    return localisedBlock
  }

  private async compile (code: string): Promise<void> {
    const id = process.hrtime.bigint().toString()
    const codeFile = path.join(this.workingDirectory, `block-${id}.ts`)
    await fsExtra.writeFile(codeFile, code)
    this.compiler.compile(code, codeFile)
  }

  private removeTemporaryFilePaths (message: string, example: CodeBlock): string {
    return message.replace(COMPILED_DOCS_FILE_PREFIX_PATTERN, chalk`{blue ${example.file}} → {cyan Code Block ${example.index}}`)
  }

  private async testCodeCompilation (example: CodeBlock): Promise<SnippetCompilationResult> {
    try {
      await this.compile(example.sanitisedCode)
      return {
        snippet: example.snippet,
        file: example.file,
        index: example.index,
        linesWithErrors: []
      }
    } catch (rawError) {
      const error = rawError instanceof Error ? rawError : new Error(String(rawError))
      error.message = this.removeTemporaryFilePaths(error.message, example)

      Object.entries(error).forEach(([key, value]) => {
        if (typeof value === 'string') {
          error[key as keyof typeof error] = this.removeTemporaryFilePaths(value, example)
        }
      })

      const linesWithErrors = new Set<number>()

      if (error instanceof TSNode.TSError) {
        const messages = error.diagnosticText.split('\n')
        messages.forEach((message: string) => {
          const [, ttyLineNumber, nonTtyLineNumber] = stripAnsi(message)
            .match(/Code Block \d+(?::(\d+):\d+)|(?:\((\d+),\d+\))/) ?? []
          const lineNumber = parseInt(ttyLineNumber || nonTtyLineNumber, 10)
          if (!isNaN(lineNumber)) {
            linesWithErrors.add(lineNumber)
          }
        })
      }

      return {
        snippet: example.snippet,
        error: error,
        linesWithErrors: [...linesWithErrors],
        file: example.file,
        index: example.index
      }
    }
  }
}
