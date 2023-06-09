/*
* Tencent is pleased to support the open source community by making
* 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) available.
*
* Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
*
* 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition) is licensed under the MIT License.
*
* License for 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community Edition):
*
* ---------------------------------------------------
* Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
* documentation files (the "Software"), to deal in the Software without restriction, including without limitation
* the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
* to permit persons to whom the Software is furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all copies or substantial portions of
* the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
* THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
* CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
* IN THE SOFTWARE.
*/

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import { IContext, IOptions, IReplaceStaticUrlPluginOption } from 'typings';
import Config from 'webpack-chain';

import {
  isFunction,
  getAbsolutePath,
} from '../../../lib/util';
import {
  validate,
} from '../../../lib/validate';

/**
 * 根据用户的配置，修改默认配置
 * @param context 上下文
 * @param localConfig 用户配置
 */
const modifyDefaultConfig = (context: IContext, localConfig: IOptions) => {
  // 生产模式下，开启替换占位符以后，publicPath 设置成 {{ BK_STATIC_URL }} 占位符，后续通过插件换成变量
  if (!!context.options.replaceStatic && context.mode === 'production') {
    // 设置为 true，默认设置成 {{ BK_STATIC_URL }}
    if (context.options.replaceStatic === true) {
      (context.options.replaceStatic as any) = {
        key: '{{ BK_STATIC_URL }}',
      };
    }
    // 未设置 key，默认设置成 {{ BK_STATIC_URL }}
    if (typeof context.options.replaceStatic === 'object' && !context.options.replaceStatic.key) {
      context.options.replaceStatic.key = '{{ BK_STATIC_URL }}';
    }
    // 用户未设置 publicPath，设置成 options.replaceStatic.key
    if (!localConfig.publicPath) {
      context.options.publicPath = (context.options.replaceStatic as IReplaceStaticUrlPluginOption).key;
    }
  }
  // 用户配置空字符串的情况下，设置为 / 表示根目录
  if (!context.options.publicPath) {
    context.options.publicPath = '/';
  }
  // 用户没有配置 copy 的情况下，copy from assetsDir to outputDir + outputAssetsDirName
  if (context.options.target === 'web' && !localConfig?.copy?.to && !localConfig?.copy?.from) {
    context.options.copy.from = context.options.assetsDir;
    context.options.copy.to = getAbsolutePath(
      context.workDir,
      context.options.outputDir,
      context.options.outputAssetsDirName,
    );
  }
  // lib 模式下，资源平铺在 outputDir 下
  if (context.options.target === 'lib') {
    context.options.outputAssetsDirName = '';
  }
};

/**
 * 加载 env 文件
 * @param workDir 执行目录
 * @param fileName 文件名称
 */
const loadEnv = (workDir, fileName) => {
  const filePath = path.resolve(workDir, fileName);
  if (fileName && fs.existsSync(filePath)) {
    dotenvExpand.expand(dotenv.config({
      path: filePath,
    }));
  }
};

/**
 * 加载用户配置，覆盖默认配置
 * @param _ webpack 配置
 * @param context 上下文
 */
export const loadUserConfig = (_: Config, context: IContext) => {
  // 用户配置地址
  const localConfigPath = path.resolve(context.workDir, 'bk.config.js');

  // 加载 .bk.local.env 文件，方便用户本地开发覆盖，添加到 .gitignore
  loadEnv(context.workDir, '.bk.local.env');
  // 加载 .bk.{mode}.env 文件
  loadEnv(context.workDir, `.bk.${context.mode}.env`);
  // 加载 .bk.env 文件
  loadEnv(context.workDir, '.bk.env');

  // 加载用户配置
  if (fs.existsSync(localConfigPath)) {
    const localConfig = require(localConfigPath);
    // 校验用户配置
    validate(localConfig);
    if (isFunction(localConfig.configureWebpack)) {
      // 如果是函数，转换为 object
      localConfig.configureWebpack = localConfig.configureWebpack(context);
    }
    context.options = Object.assign({}, context.options, localConfig);
    // 加载项目自定义 env 文件，因为用户可能会在配置中使用变量，需要提前读取变量文件，所以自定义变量最后读取，优先级最低
    loadEnv(context.workDir, context.options?.customEnv || '');
    // 修改默认配置
    modifyDefaultConfig(context, localConfig);
  }
};

/**
 * 基于 service 配置生成 webpack 配置后，使用用户配置的 configureWebpack 和 chainWebpack 修改 webpack 配置
 * @param config webpack 配置
 * @param context 上下文
 * @returns webpack 配置
 */
export const applyUserConfig = (config: Config, context: IContext) => {
  config.merge(context.options.configureWebpack);
  const finallyConfig = context.options.chainWebpack(config);
  if (!(finallyConfig instanceof Config)) {
    const { log } = require('@blueking/cli-utils');
    log.error('\nbk.config.js 文件配置有误：\n    chainWebpack 方法需要返回一个 webpack-chain 对象，请修改后重试\n');
    process.exit(0);
  }
  return finallyConfig;
};